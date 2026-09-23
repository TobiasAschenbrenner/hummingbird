import base64
import io
import os
import re
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from threading import Barrier
from time import time
from unittest.mock import patch

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from flask_migrate import downgrade, upgrade
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from app import create_app
from app.articles.models import Article, Category, Tag, article_tags
from app.extensions import db
from app.users.models import User
from app.users.queries import get_user_by_email

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/x8AAwMCAO+a5WQAAAAASUVORK5CYII="
)
MIGRATIONS_DIRECTORY = str(Path(__file__).resolve().parents[1] / "migrations")


class ApplicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database_url = os.environ.get("TEST_DATABASE_URL")
        if not database_url:
            raise unittest.SkipTest(
                "Set TEST_DATABASE_URL to a dedicated PostgreSQL test database."
            )
        url = make_url(database_url)
        if url.get_backend_name() != "postgresql" or not (url.database or "").endswith(
            "_test"
        ):
            raise RuntimeError(
                "Tests require a PostgreSQL database whose name ends in _test."
            )
        cls.uploads = tempfile.TemporaryDirectory(prefix="hummingbird-test-uploads-")
        cls.addClassCleanup(cls.uploads.cleanup)
        cls.app = create_app(
            {
                "TESTING": True,
                "SQLALCHEMY_DATABASE_URI": database_url,
                "SECRET_KEY": "test-secret-only",
                "UPLOADS_PATH": Path(cls.uploads.name),
            }
        )
        with cls.app.app_context():
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def setUp(self):
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        self.addCleanup(db.session.remove)
        db.session.execute(
            text("TRUNCATE articles, users, categories, tags RESTART IDENTITY CASCADE")
        )
        db.session.add_all(
            Category(slug=slug, name=slug.title())
            for slug in ("design", "tech", "mobile")
        )
        db.session.commit()
        for image in Path(self.uploads.name).iterdir():
            if image.is_file():
                image.unlink()
        self.client = self.app.test_client()

    def create_user(self, email="author@example.test"):
        user = User(
            username="Author",
            email=email,
            password_hash=generate_password_hash("password123"),
        )
        db.session.add(user)
        db.session.commit()
        return user

    def csrf_token(self, *, client=None, page="/"):
        client = client or self.client
        response = client.get(page)
        self.assertEqual(response.status_code, 200)
        match = re.search(rb'name="csrf_token" value="([^"]+)"', response.data)
        self.assertIsNotNone(match, "The page must render a CSRF token")
        return match.group(1).decode("ascii")

    def post_form(self, path, *, data=None, client=None, **kwargs):
        client = client or self.client
        form_data = {**(data or {}), "csrf_token": self.csrf_token(client=client)}
        return client.post(path, data=form_data, **kwargs)

    def login(self):
        return self.post_form(
            "/auth/login",
            data={
                "login_email": "author@example.test",
                "login_password": "password123",
            },
        )

    def article_data(self, **overrides):
        data = {
            "title": "First article",
            "description": "A description",
            "category": "tech",
            "body": "Article body",
            "image": (io.BytesIO(PNG), "cover.png"),
        }
        data.update(overrides)
        return data

    def build_article(self, *, slug, **overrides):
        values = {
            "slug": slug,
            "title": "Test article",
            "description": "Test description",
            "body": "Test article body",
        }
        values.update(overrides)
        return Article(**values)

    def test_homepage_and_missing_article(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/missing-article").status_code, 404)

    def test_registration_stores_password_hash(self):
        response = self.post_form(
            "/auth/register",
            data={
                "register_name": "Author",
                "register_email": " \tAuthor@Example.test\r\n",
                "register_password": "password123",
                "register_password_confirmation": "password123",
            },
        )
        self.assertEqual(response.status_code, 302)
        user = User.query.one()
        self.assertEqual(user.email, "Author@Example.test")
        self.assertNotEqual(user.password_hash, "password123")
        self.assertTrue(check_password_hash(user.password_hash, "password123"))

    def test_login_and_logout(self):
        self.create_user()
        response = self.post_form(
            "/auth/login",
            data={
                "login_email": "author@example.test",
                "login_password": "incorrect",
            },
            follow_redirects=True,
        )
        self.assertIn(b"Invalid email or password", response.data)
        self.assertEqual(self.login().status_code, 302)
        self.assertEqual(self.client.get("/new-post").status_code, 200)
        self.post_form("/logout")
        self.assertEqual(self.client.get("/new-post").status_code, 401)

    def test_all_post_forms_render_csrf_tokens(self):
        pages = [self.client.get("/")]
        self.create_user()
        self.login()
        pages.append(self.client.get("/new-post"))
        forms = {}
        for page in pages:
            self.assertEqual(page.status_code, 200)
            forms.update(
                re.findall(
                    rb'<form\b[^>]*action="([^"]+)"[^>]*>(.*?)</form>',
                    page.data,
                    flags=re.DOTALL,
                )
            )
        self.assertEqual(
            set(forms), {b"/auth/register", b"/auth/login", b"/new-post", b"/logout"}
        )
        for action, form in forms.items():
            with self.subTest(action=action):
                self.assertRegex(form, rb'name="csrf_token" value="[^"]+"')

    def test_csrf_rejects_missing_invalid_and_other_session_tokens(self):
        author_id = self.create_user().id
        self.create_user(email="other@example.test")
        self.login()
        with self.app.app_context():
            foreign_token = self.csrf_token(client=self.app.test_client())
        for token in (None, "invalid-token", foreign_token):
            for path in ("/auth/register", "/auth/login", "/new-post", "/logout"):
                with self.subTest(token=token, path=path):
                    if path == "/auth/register":
                        data = {
                            "register_name": "Unwanted account",
                            "register_email": "unwanted@example.test",
                            "register_password": "secret-password",
                            "register_password_confirmation": "secret-password",
                        }
                    elif path == "/auth/login":
                        data = {
                            "login_email": "other@example.test",
                            "login_password": "password123",
                        }
                    elif path == "/new-post":
                        data = self.article_data(tags="Security")
                    else:
                        data = {}
                    if token is not None:
                        data["csrf_token"] = token
                    response = self.client.post(path, data=data)
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(b"Your form could not be verified", response.data)
                    self.assertNotIn(b"secret-password", response.data)
                    self.assertEqual(User.query.count(), 2)
                    self.assertEqual(Article.query.count(), 0)
                    self.assertEqual(Tag.query.count(), 0)
                    self.assertEqual(list(Path(self.uploads.name).iterdir()), [])
                    with self.client.session_transaction() as session:
                        self.assertEqual(session.get("_user_id"), str(author_id))

    def test_expired_csrf_token_is_rejected_and_a_fresh_token_works(self):
        author_id = self.create_user().id
        with patch(
            "itsdangerous.timed.TimestampSigner.get_timestamp",
            return_value=int(time()) - 3601,
        ):
            expired_token = self.csrf_token()
        data = {
            "login_email": "author@example.test",
            "login_password": "password123",
            "csrf_token": expired_token,
        }
        response = self.client.post("/auth/login", data=data)
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"refresh the page", response.data)
        with self.client.session_transaction() as session:
            self.assertNotIn("_user_id", session)
        with self.app.app_context():
            data["csrf_token"] = self.csrf_token()
        response = self.client.post("/auth/login", data=data)
        self.assertEqual(response.status_code, 302)
        with self.client.session_transaction() as session:
            self.assertEqual(session.get("_user_id"), str(author_id))

    def test_https_csrf_checks_the_referrer(self):
        author_id = self.create_user().id
        data = {
            "login_email": "author@example.test",
            "login_password": "password123",
            "csrf_token": self.csrf_token(),
        }
        for headers in ({}, {"Referer": "https://other.example/"}):
            with self.subTest(headers=headers):
                response = self.client.post(
                    "/auth/login",
                    data=data,
                    base_url="https://localhost",
                    headers=headers,
                )
                self.assertEqual(response.status_code, 400)
                with self.client.session_transaction() as session:
                    self.assertNotIn("_user_id", session)
        response = self.client.post(
            "/auth/login",
            data=data,
            base_url="https://localhost",
            headers={"Referer": "https://localhost/"},
        )
        self.assertEqual(response.status_code, 302)
        with self.client.session_transaction() as session:
            self.assertEqual(session.get("_user_id"), str(author_id))

    def test_get_requests_cannot_log_out_a_user(self):
        self.create_user()
        self.login()
        response = self.client.get("/logout")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get("/new-post").status_code, 200)
        self.assertEqual(self.post_form("/logout").status_code, 302)
        self.assertEqual(self.client.get("/new-post").status_code, 401)

    def test_email_login_ignores_case_and_surrounding_whitespace(self):
        stored_email = " \tAuthor@Example.Test\r\n"
        self.create_user(email=stored_email)
        for email in ("author@example.test", " \vAUTHOR@EXAMPLE.TEST\f "):
            with self.subTest(email=email):
                response = self.post_form(
                    "/auth/login",
                    data={"login_email": email, "login_password": "password123"},
                )
                self.assertEqual(response.status_code, 302)
                self.assertEqual(self.client.get("/new-post").status_code, 200)
                self.post_form("/logout")
        self.assertEqual(User.query.one().email, stored_email)

    def test_registration_rejects_existing_email_variants(self):
        self.create_user(email=" \tAuthor@Example.Test\r\n")
        before = db.session.execute(text("SELECT * FROM users ORDER BY id")).all()
        for email in ("author@example.test", " \vAUTHOR@EXAMPLE.TEST\f "):
            with self.subTest(email=email):
                response = self.post_form(
                    "/auth/register",
                    data={
                        "register_name": "Another Author",
                        "register_email": email,
                        "register_password": "different-password",
                        "register_password_confirmation": "different-password",
                    },
                    follow_redirects=True,
                )
                self.assertIn(b"already registered", response.data)
                self.assertEqual(self.client.get("/new-post").status_code, 401)
        self.assertEqual(
            db.session.execute(text("SELECT * FROM users ORDER BY id")).all(), before
        )

    def test_anonymous_article_creation_is_rejected(self):
        self.assertEqual(self.client.get("/new-post").status_code, 401)
        self.assertEqual(
            self.post_form("/new-post", data=self.article_data()).status_code, 401
        )
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_article_creation_and_detail(self):
        user = self.create_user()
        self.login()
        response = self.post_form(
            "/new-post", data=self.article_data(), follow_redirects=True
        )
        self.assertEqual(response.status_code, 200)
        article = Article.query.one()
        self.assertEqual(article.author_id, user.id)
        self.assertEqual(article.category.slug, "tech")
        self.assertTrue((Path(self.uploads.name) / article.image_filename).exists())
        detail = self.client.get(f"/{article.slug}")
        self.assertIn(b"Article body", detail.data)

    def test_missing_title_does_not_create_an_article(self):
        self.create_user()
        self.login()
        response = self.post_form("/new-post", data=self.article_data(title=""))
        self.assertIn(b"Please fill out all fields", response.data)
        self.assertEqual(Article.query.count(), 0)

    def test_article_field_validation(self):
        self.create_user()
        self.login()
        for overrides in [
            {"title": " "},
            {"title": "x" * 56},
            {"description": "x" * 251},
            {"category": "unknown"},
            {"category": ""},
            {"body": " "},
            {"title": "new-post"},
            {"title": "!!!"},
        ]:
            with self.subTest(overrides=overrides):
                response = self.post_form(
                    "/new-post", data=self.article_data(**overrides)
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(Article.query.count(), 0)
                self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_creation_redirects_and_duplicate_slug_is_handled(self):
        self.create_user()
        self.login()
        response = self.post_form("/new-post", data=self.article_data())
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/")
        response = self.post_form("/new-post", data=self.article_data())
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"already exists", response.data)
        self.assertNotIn(b"INSERT INTO", response.data)
        self.assertEqual(Article.query.count(), 1)

    def test_missing_image_has_a_useful_error(self):
        self.create_user()
        self.login()
        data = self.article_data()
        del data["image"]
        response = self.post_form("/new-post", data=data)
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"Please choose an image", response.data)
        self.assertEqual(Article.query.count(), 0)

    def test_rejected_upload_does_not_create_an_article(self):
        self.create_user()
        self.login()
        response = self.post_form(
            "/new-post", data=self.article_data(image=(io.BytesIO(b"text"), "bad.html"))
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"Unsupported image extension", response.data)
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_database_failure_rolls_back_and_removes_new_upload(self):
        self.create_user()
        self.login()
        self.post_form("/new-post", data=self.article_data())
        existing_files = set(Path(self.uploads.name).iterdir())

        def force_duplicate_slug(mapper, connection, article):
            article.slug = "first-article"

        event.listen(Article, "before_insert", force_duplicate_slug)
        try:
            response = self.post_form(
                "/new-post",
                data=self.article_data(title="Concurrent article", tags="New Topic"),
            )
        finally:
            event.remove(Article, "before_insert", force_duplicate_slug)
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"already exists", response.data)
        self.assertEqual(Article.query.count(), 1)
        self.assertEqual(Tag.query.count(), 0)
        self.assertEqual(db.session.execute(db.select(article_tags)).all(), [])
        self.assertEqual(set(Path(self.uploads.name).iterdir()), existing_files)
        response = self.post_form(
            "/new-post",
            data=self.article_data(title="After rollback", tags="New Topic"),
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Article.query.count(), 2)
        self.assertEqual(Tag.query.one().slug, "new-topic")

    def test_article_tags_are_normalized_deduplicated_and_shared(self):
        self.create_user()
        self.login()
        response = self.post_form(
            "/new-post",
            data=self.article_data(
                tags=" Python, python, Machine  Learning, machine-learning, Café, Cafe\u0301, , "
            ),
        )
        self.assertEqual(response.status_code, 302)
        first = Article.query.one()
        self.assertEqual(
            {tag.slug for tag in first.tags}, {"python", "machine-learning", "café"}
        )
        response = self.post_form(
            "/new-post", data=self.article_data(title="Second article", tags="PYTHON")
        )
        self.assertEqual(response.status_code, 302)
        python_tag = Tag.query.filter_by(slug="python").one()
        self.assertEqual(python_tag.name, "Python")
        self.assertEqual(len(python_tag.articles), 2)
        self.assertEqual(Tag.query.count(), 3)
        self.assertEqual(len(db.session.execute(db.select(article_tags)).all()), 4)

    def test_invalid_tags_do_not_write_articles_tags_or_images(self):
        self.create_user()
        self.login()
        for tags in (
            "a" * 251,
            "a" * 41,
            "a,b,c,d,e,f",
            "<script>",
            "two--hyphens",
            "under_score",
        ):
            with self.subTest(tags=tags):
                response = self.post_form(
                    "/new-post", data=self.article_data(tags=tags)
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(Article.query.count(), 0)
                self.assertEqual(Tag.query.count(), 0)
                self.assertEqual(list(Path(self.uploads.name).iterdir()), [])
        valid = self.post_form(
            "/new-post", data=self.article_data(tags=f"{'a' * 40},b,c,d,e")
        )
        self.assertEqual(valid.status_code, 302)
        self.assertEqual(len(Article.query.one().tags), 5)

    def test_tag_form_preserves_input_after_validation_errors(self):
        self.create_user()
        self.login()
        self.assertIn(b'name="tags"', self.client.get("/new-post").data)
        response = self.post_form(
            "/new-post", data=self.article_data(title="", tags="Python, Databases")
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn(b'value="Python, Databases"', response.data)
        self.assertEqual(Tag.query.count(), 0)

    def test_concurrent_posts_reuse_the_same_tags(self):
        self.create_user()
        db.session.remove()
        barrier = Barrier(2)

        def synchronize_tag_inserts(
            connection, cursor, statement, parameters, context, executemany
        ):
            if statement.startswith("INSERT INTO tags"):
                barrier.wait(timeout=5)

        def publish(number, tags):
            with self.app.test_client() as client:
                response = self.post_form(
                    "/auth/login",
                    client=client,
                    data={
                        "login_email": "author@example.test",
                        "login_password": "password123",
                    },
                )
                if response.status_code != 302:
                    raise AssertionError("Worker login failed")
                response = self.post_form(
                    "/new-post",
                    client=client,
                    data=self.article_data(
                        title=f"Concurrent post {number}", tags=tags
                    ),
                )
                return response.status_code

        engine = db.engine
        event.listen(engine, "before_cursor_execute", synchronize_tag_inserts)
        try:
            with ThreadPoolExecutor(max_workers=2) as workers:
                results = [
                    workers.submit(publish, 1, "Python, Databases"),
                    workers.submit(publish, 2, "Databases, python"),
                ]
                self.assertEqual(
                    [result.result(timeout=10) for result in results], [302, 302]
                )
        finally:
            event.remove(engine, "before_cursor_execute", synchronize_tag_inserts)
        self.assertEqual(Tag.query.count(), 2)
        self.assertEqual(Article.query.count(), 2)
        self.assertEqual(len(db.session.execute(db.select(article_tags)).all()), 4)

    def test_concurrent_registration_duplicate_is_handled(self):
        db.session.remove()
        barrier = Barrier(2)

        def synchronize_user_inserts(
            connection, cursor, statement, parameters, context, executemany
        ):
            if statement.startswith("INSERT INTO users"):
                barrier.wait(timeout=5)

        def register(email):
            with self.app.test_client() as client:
                response = self.post_form(
                    "/auth/register",
                    client=client,
                    data={
                        "register_name": "Author",
                        "register_email": email,
                        "register_password": "password123",
                        "register_password_confirmation": "password123",
                    },
                    follow_redirects=True,
                )
                return (
                    response.status_code,
                    b"already registered" in response.data,
                    client.get("/new-post").status_code,
                )

        engine = db.engine
        event.listen(engine, "before_cursor_execute", synchronize_user_inserts)
        try:
            with ThreadPoolExecutor(max_workers=2) as workers:
                results = [
                    workers.submit(register, email)
                    for email in (
                        "Concurrent@Example.test",
                        " \tCONCURRENT@EXAMPLE.TEST ",
                    )
                ]
                self.assertEqual(
                    sorted(result.result(timeout=10) for result in results),
                    [(200, False, 200), (200, True, 401)],
                )
        finally:
            event.remove(engine, "before_cursor_execute", synchronize_user_inserts)
        self.assertEqual(User.query.count(), 1)
        self.assertTrue(
            check_password_hash(User.query.one().password_hash, "password123")
        )

    def test_related_data_loading_does_not_add_per_article_queries(self):
        from app.articles.queries import paginate_articles

        users = [
            self.create_user(email=f"author{number}@example.test")
            for number in range(3)
        ]
        category = Category.query.filter_by(slug="tech").one()
        tags = [Tag(slug="python", name="Python"), Tag(slug="flask", name="Flask")]
        db.session.add_all(
            [
                self.build_article(
                    title=f"Article {number}",
                    slug=f"article-{number}",
                    author_id=user.id,
                    category=category,
                    tags=tags,
                )
                for number, user in enumerate(users)
            ]
        )
        db.session.commit()
        db.session.expire_all()
        statements = []

        def record_statement(
            connection, cursor, statement, parameters, context, executemany
        ):
            statements.append(statement)

        event.listen(db.engine, "before_cursor_execute", record_statement)
        try:
            articles = paginate_articles(page=1, per_page=12).items
            self.assertEqual(
                [article.author.username for article in articles], ["Author"] * 3
            )
            self.assertEqual(
                [article.category.name for article in articles], ["Tech"] * 3
            )
            self.assertEqual(
                [[tag.name for tag in article.tags] for article in articles],
                [["Flask", "Python"]] * 3,
            )
        finally:
            event.remove(db.engine, "before_cursor_execute", record_statement)
        self.assertLessEqual(len(statements), 3)

    def test_tags_are_visible_and_escaped_on_article_pages(self):
        db.session.add(
            self.build_article(
                title="Tagged story",
                slug="tagged-story",
                body="Body",
                tags=[Tag(slug="unsafe-label", name="<script>alert(1)</script>")],
            )
        )
        db.session.commit()
        for path in ("/", "/tagged-story"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn(b'aria-label="Article tags"', response.data)
                self.assertIn(b"&lt;script&gt;alert(1)&lt;/script&gt;", response.data)
                self.assertNotIn(b"<script>alert(1)</script>", response.data)

    def test_articles_without_tags_do_not_render_an_empty_tag_list(self):
        db.session.add(self.build_article(title="No tags", slug="no-tags", body="Body"))
        db.session.commit()
        for path in ("/", "/no-tags"):
            self.assertNotIn(b'aria-label="Article tags"', self.client.get(path).data)

    def test_article_order_and_pagination(self):
        user = self.create_user()
        category = Category.query.filter_by(slug="tech").one()
        db.session.add_all(
            [
                self.build_article(
                    title=f"Article {number}",
                    slug=f"article-{number}",
                    body="Body",
                    description="Description",
                    category=category,
                    created_at=date.today(),
                    image_filename="cover.png",
                    author_id=user.id,
                )
                for number in range(13)
            ]
        )
        db.session.commit()
        first_page = self.client.get("/").data
        self.assertIn(b"/article-12", first_page)
        self.assertNotIn(b'"/article-0"', first_page)
        self.assertIn(b'"/article-0"', self.client.get("/?page=2").data)

    def test_category_filtering_happens_before_pagination(self):
        user = self.create_user()
        for slug in ("tech", "design"):
            category = Category.query.filter_by(slug=slug).one()
            db.session.add_all(
                self.build_article(
                    title=f"{slug} article {number}",
                    slug=f"{slug}-{number}",
                    author=user,
                    category=category,
                )
                for number in range(13)
            )
        db.session.commit()
        self.assertNotIn(b'href="/tech-', self.client.get("/").data)
        first_page = self.client.get("/?category=tech")
        self.assertEqual(first_page.status_code, 200)
        self.assertEqual(first_page.data.count(b'class="article-card"'), 12)
        self.assertIn(b'href="/tech-12"', first_page.data)
        self.assertNotIn(b'href="/design-', first_page.data)
        self.assertIn(b"page=2&amp;category=tech", first_page.data)
        self.assertIn(b'aria-current="page">Tech (13)</a>', first_page.data)
        self.assertNotIn(b"article_filters.js", first_page.data)
        second_page = self.client.get("/?category=tech&page=2")
        self.assertEqual(second_page.data.count(b'class="article-card"'), 1)
        self.assertIn(b'href="/tech-0"', second_page.data)
        self.assertIn(b"page=1&amp;category=tech", second_page.data)
        self.assertIn(b'href="/?category=design"', second_page.data)

    def test_empty_and_unknown_category_filters(self):
        empty = self.client.get("/?category=mobile")
        self.assertEqual(empty.status_code, 200)
        self.assertIn(b"No articles in this category yet", empty.data)
        self.assertEqual(self.client.get("/?category=unknown").status_code, 404)
        self.assertEqual(self.client.get("/?category=").status_code, 200)
        self.assertEqual(self.client.get("/?category=tech&page=999").status_code, 404)

    def test_tag_filtering_combines_with_categories_and_pagination(self):
        from app.articles.queries import (
            list_categories_with_article_counts,
            paginate_articles,
        )

        python = Tag(slug="python", name="Python")
        flask = Tag(slug="flask", name="Flask")
        tech = Category.query.filter_by(slug="tech").one()
        design = Category.query.filter_by(slug="design").one()
        db.session.add_all(
            self.build_article(
                title=f"Tech {number}",
                slug=f"tech-{number}",
                category=tech,
                tags=[python, flask],
            )
            for number in range(13)
        )
        db.session.add_all(
            self.build_article(
                title=f"Design {number}",
                slug=f"design-{number}",
                category=design,
                tags=[python],
            )
            for number in range(2)
        )
        db.session.add(
            self.build_article(
                title="Flask only", slug="flask-only", category=design, tags=[flask]
            )
        )
        db.session.commit()
        pagination = paginate_articles(page=1, per_page=12, tag_id=python.id)
        self.assertEqual(pagination.total, 15)
        self.assertEqual(len({article.id for article in pagination.items}), 12)
        self.assertEqual(
            {
                category.slug: count
                for category, count in list_categories_with_article_counts(
                    tag_id=python.id
                )
            },
            {"tech": 13, "design": 2, "mobile": 0},
        )
        tagged = self.client.get("/?tag=python")
        self.assertEqual(tagged.status_code, 200)
        self.assertIn(b"Design (2)", tagged.data)
        self.assertIn(b"Mobile (0)", tagged.data)
        self.assertIn(b'href="/?page=2&amp;tag=python"', tagged.data)
        self.assertNotIn(b'href="/flask-only"', tagged.data)
        self.assertEqual(
            self.client.get("/?tag=python&page=2").data.count(b'class="article-card"'),
            3,
        )
        combined = self.client.get("/?category=tech&tag=python")
        self.assertEqual(combined.data.count(b'class="article-card"'), 12)
        self.assertNotIn(b'href="/design-', combined.data)
        self.assertIn(
            b'href="/?page=2&amp;category=tech&amp;tag=python"', combined.data
        )
        self.assertIn(b'href="/?tag=python"', combined.data)
        self.assertIn(b'href="/?category=tech">Clear tag filter', combined.data)
        self.assertIn(b'href="/?tag=flask&amp;category=tech"', combined.data)
        second = self.client.get("/?category=tech&tag=python&page=2")
        self.assertEqual(second.data.count(b'class="article-card"'), 1)
        self.assertIn(b'href="/?category=design&amp;tag=python"', second.data)
        self.assertEqual(
            self.client.get("/?category=mobile&tag=python").status_code, 200
        )

    def test_empty_and_unknown_tag_filters(self):
        db.session.add(Tag(slug="unused", name="Unused"))
        db.session.commit()
        response = self.client.get("/?tag=unused")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"No articles match these filters", response.data)
        self.assertIn(b"Design (0)", response.data)
        self.assertEqual(self.client.get("/?tag=unknown").status_code, 404)
        self.assertEqual(
            self.client.get("/?tag=unused&category=unknown").status_code, 404
        )
        self.assertEqual(self.client.get("/?tag=").status_code, 200)

    def test_tag_links_work_with_unicode_names(self):
        db.session.add(
            self.build_article(
                title="Coffee story",
                slug="coffee-story",
                tags=[Tag(slug="café", name="Café")],
            )
        )
        db.session.commit()
        for path in ("/", "/coffee-story"):
            self.assertIn(b'href="/?tag=caf%C3%A9"', self.client.get(path).data)
        response = self.client.get("/", query_string={"tag": "café"})
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Coffee story", response.data)

    def test_category_counts_include_empty_categories_and_all_pages(self):
        from app.articles.queries import list_categories_with_article_counts

        for slug, count in (("tech", 13), ("design", 2)):
            category = Category.query.filter_by(slug=slug).one()
            db.session.add_all(
                self.build_article(slug=f"{slug}-{number}", category=category)
                for number in range(count)
            )
        db.session.add(self.build_article(slug="uncategorized"))
        db.session.commit()
        db.session.remove()
        statements = []

        def record_statement(
            connection, cursor, statement, parameters, context, executemany
        ):
            statements.append(statement)

        event.listen(db.engine, "before_cursor_execute", record_statement)
        try:
            counts = {
                category.slug: count
                for category, count in list_categories_with_article_counts()
            }
        finally:
            event.remove(db.engine, "before_cursor_execute", record_statement)
        self.assertEqual(counts, {"design": 2, "mobile": 0, "tech": 13})
        self.assertEqual(len(statements), 1)
        for path in ("/", "/?category=tech", "/?category=tech&page=2"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn(b"Tech (13)", response.data)
                self.assertIn(b"Design (2)", response.data)
                self.assertIn(b"Mobile (0)", response.data)

    def test_category_counts_are_zero_without_articles(self):
        response = self.client.get("/")
        for name in ("Design", "Tech", "Mobile"):
            self.assertIn(f"{name} (0)".encode(), response.data)

    def test_models_match_committed_migration(self):
        with db.engine.connect() as connection:
            context = MigrationContext.configure(
                connection, opts={"compare_type": True, "compare_server_default": True}
            )
            self.assertEqual(compare_metadata(context, db.metadata), [])

    def test_article_content_constraints_reject_invalid_inserts_and_updates(self):
        article = self.build_article(slug="existing-story")
        db.session.add(article)
        db.session.commit()
        article_id = article.id
        valid_values = {
            "title": "Another story",
            "slug": "another-story",
            "description": "Another description",
            "text": "Another article body",
        }
        before = db.session.execute(text("SELECT * FROM articles ORDER BY id")).all()
        for column in valid_values:
            for value in (None, "", "   ", " \t\n\r\f\v "):
                statements = {
                    "insert": Article.__table__.insert().values(
                        {**valid_values, column: value}
                    ),
                    "update": Article.__table__.update()
                    .where(Article.id == article_id)
                    .values({column: value}),
                }
                for operation, statement in statements.items():
                    with self.subTest(column=column, value=value, operation=operation):
                        with self.assertRaises(IntegrityError) as raised:
                            db.session.execute(statement)
                            db.session.commit()
                        db.session.rollback()
                        if value is None:
                            self.assertEqual(raised.exception.orig.pgcode, "23502")
                            self.assertEqual(
                                raised.exception.orig.diag.column_name, column
                            )
                        else:
                            self.assertEqual(raised.exception.orig.pgcode, "23514")
                            self.assertEqual(
                                raised.exception.orig.diag.constraint_name,
                                f"articles_{column}_not_blank",
                            )
        self.assertEqual(
            db.session.execute(text("SELECT * FROM articles ORDER BY id")).all(), before
        )
        valid_values.update(
            title="É" * 55,
            slug="s" * 80,
            description="D" * 250,
            text=" \nFirst paragraph about café.\n\nSecond paragraph.\t ",
        )
        db.session.execute(
            Article.__table__.update()
            .where(Article.id == article_id)
            .values(valid_values)
        )
        db.session.commit()
        updated = Article.query.one()
        self.assertEqual(
            (updated.title, updated.slug, updated.description, updated.body),
            tuple(valid_values.values()),
        )

    def test_article_content_migration_preserves_records_and_relationships(self):
        user = self.create_user()
        category = Category.query.filter_by(slug="tech").one()
        db.session.add_all(
            [
                self.build_article(
                    slug="existing-story",
                    title="  Existing story  ",
                    description=" A description ",
                    body="\nA paragraph about café.\n\nAnother paragraph.\n",
                    author=user,
                    category=category,
                    tags=[Tag(slug="python", name="Python")],
                    created_at=date(2024, 1, 2),
                    image_filename="existing.webp",
                ),
                self.build_article(slug="uncategorized"),
            ]
        )
        db.session.commit()
        tables = ("users", "articles", "categories", "tags", "article_tags")
        before = {
            table: db.session.execute(
                text(f"SELECT * FROM {table} ORDER BY 1, 2")
            ).all()
            for table in tables
        }
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="e57031c65005")
            upgrade(directory=MIGRATIONS_DIRECTORY)
            after = {
                table: db.session.execute(
                    text(f"SELECT * FROM {table} ORDER BY 1, 2")
                ).all()
                for table in tables
            }
            self.assertEqual(after, before)
            self.assertEqual(self.client.get("/existing-story").status_code, 200)
            self.assertIsNone(
                Article.query.filter_by(slug="uncategorized").one().category_id
            )
            db.session.remove()
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="e57031c65005")
            restored = {
                table: db.session.execute(
                    text(f"SELECT * FROM {table} ORDER BY 1, 2")
                ).all()
                for table in tables
            }
            self.assertEqual(restored, before)
        finally:
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def test_article_content_migration_refuses_invalid_existing_articles(self):
        db.session.add(self.build_article(slug="valid-story"))
        db.session.commit()
        valid_values = {
            "title": "Legacy story",
            "slug": "legacy-story",
            "description": "Legacy description",
            "text": "Legacy body",
        }
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="e57031c65005")
            for column in valid_values:
                for value in (None, "", "   ", " \t\n\r\f\v "):
                    with self.subTest(column=column, value=value):
                        invalid_article_id = db.session.execute(
                            Article.__table__.insert()
                            .values({**valid_values, column: value})
                            .returning(Article.id)
                        ).scalar_one()
                        db.session.commit()
                        before = db.session.execute(
                            text("SELECT * FROM articles ORDER BY id")
                        ).all()
                        db.session.remove()
                        try:
                            with self.assertRaisesRegex(
                                DBAPIError, "Cannot enforce required article content"
                            ):
                                upgrade(directory=MIGRATIONS_DIRECTORY)
                            self.assertEqual(
                                db.session.execute(
                                    text("SELECT version_num FROM alembic_version")
                                ).scalar_one(),
                                "e57031c65005",
                            )
                            self.assertEqual(
                                db.session.execute(
                                    text("SELECT * FROM articles ORDER BY id")
                                ).all(),
                                before,
                            )
                        finally:
                            db.session.rollback()
                            db.session.execute(
                                Article.__table__.delete().where(
                                    Article.id == invalid_article_id
                                )
                            )
                            db.session.commit()
                            db.session.remove()
        finally:
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def test_user_required_fields_reject_invalid_inserts_and_updates(self):
        user = self.create_user()
        user_id = user.id
        valid_values = {
            "username": "Another Author",
            "email": "another@example.test",
            "password": user.password_hash,
        }
        before = db.session.execute(text("SELECT * FROM users ORDER BY id")).all()
        for column in valid_values:
            for value in (None, "", "   ", " \t\n\r\f\v "):
                statements = {
                    "insert": User.__table__.insert().values(
                        {**valid_values, column: value}
                    ),
                    "update": User.__table__.update()
                    .where(User.id == user_id)
                    .values({column: value}),
                }
                for operation, statement in statements.items():
                    with self.subTest(column=column, value=value, operation=operation):
                        with self.assertRaises(IntegrityError) as raised:
                            db.session.execute(statement)
                            db.session.commit()
                        db.session.rollback()
                        if value is None:
                            self.assertEqual(raised.exception.orig.pgcode, "23502")
                            self.assertEqual(
                                raised.exception.orig.diag.column_name, column
                            )
                        else:
                            self.assertEqual(raised.exception.orig.pgcode, "23514")
                            self.assertEqual(
                                raised.exception.orig.diag.constraint_name,
                                f"users_{column}_not_blank",
                            )
        self.assertEqual(
            db.session.execute(text("SELECT * FROM users ORDER BY id")).all(), before
        )

    def test_database_email_uniqueness_covers_inserts_and_updates(self):
        self.create_user(email="Author@Example.test")
        other = self.create_user(email="other@example.test")
        other_id, password_hash = other.id, other.password_hash
        before = db.session.execute(text("SELECT * FROM users ORDER BY id")).all()
        for email in (
            "Author@Example.test",
            "author@example.test",
            "AUTHOR@EXAMPLE.TEST",
            " \t\n\r\f\vAUTHOR@EXAMPLE.TEST\v\f\r\n\t ",
        ):
            statements = {
                "insert": User.__table__.insert().values(
                    username="Duplicate", email=email, password=password_hash
                ),
                "update": User.__table__.update()
                .where(User.id == other_id)
                .values(email=email),
            }
            for operation, statement in statements.items():
                with self.subTest(email=email, operation=operation):
                    with self.assertRaises(IntegrityError) as raised:
                        db.session.execute(statement)
                        db.session.commit()
                    db.session.rollback()
                    self.assertEqual(raised.exception.orig.pgcode, "23505")
                    self.assertEqual(
                        raised.exception.orig.diag.constraint_name,
                        "ix_users_email_normalized",
                    )
        self.assertEqual(
            db.session.execute(text("SELECT * FROM users ORDER BY id")).all(), before
        )
        for email in ("author+notes@example.test", "a.uthor@example.test"):
            user = self.create_user(email=email)
            self.assertEqual(get_user_by_email(email.upper()).id, user.id)
        self.assertEqual(User.query.count(), 4)

    def test_email_migration_preserves_users_and_article_links(self):
        user = self.create_user(email=" \tMixed.Case@example.test\r\n")
        db.session.add(self.build_article(slug="existing-story", author=user))
        db.session.commit()
        before_users = db.session.execute(text("SELECT * FROM users ORDER BY id")).all()
        before_articles = db.session.execute(
            text("SELECT * FROM articles ORDER BY id")
        ).all()
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="d46f20b54004")
            upgrade(directory=MIGRATIONS_DIRECTORY)
            self.assertEqual(
                get_user_by_email("MIXED.CASE@example.test").id, before_users[0].id
            )
            db.session.remove()
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="d46f20b54004")
            self.assertEqual(
                db.session.execute(text("SELECT * FROM users ORDER BY id")).all(),
                before_users,
            )
            self.assertEqual(
                db.session.execute(text("SELECT * FROM articles ORDER BY id")).all(),
                before_articles,
            )
        finally:
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def test_email_migration_refuses_conflicting_accounts(self):
        user = self.create_user(email="Author@Example.test")
        password_hash = user.password_hash
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="d46f20b54004")
            for email in ("author@example.test", " \t\vAUTHOR@EXAMPLE.TEST\f\r\n "):
                with self.subTest(email=email):
                    conflicting_id = db.session.execute(
                        User.__table__.insert()
                        .values(username="Legacy", email=email, password=password_hash)
                        .returning(User.id)
                    ).scalar_one()
                    db.session.commit()
                    before = db.session.execute(
                        text("SELECT * FROM users ORDER BY id")
                    ).all()
                    db.session.remove()
                    try:
                        with self.assertRaisesRegex(
                            DBAPIError, "Cannot enforce email uniqueness"
                        ):
                            upgrade(directory=MIGRATIONS_DIRECTORY)
                        self.assertEqual(
                            db.session.execute(
                                text("SELECT * FROM users ORDER BY id")
                            ).all(),
                            before,
                        )
                        self.assertEqual(
                            db.session.execute(
                                text("SELECT version_num FROM alembic_version")
                            ).scalar_one(),
                            "d46f20b54004",
                        )
                    finally:
                        db.session.rollback()
                        db.session.execute(
                            User.__table__.delete().where(User.id == conflicting_id)
                        )
                        db.session.commit()
                        db.session.remove()
        finally:
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def test_user_field_migration_preserves_users_and_articles(self):
        user = self.create_user(email="Mixed.Case@example.test")
        user.username = "  Zoë Author  "
        db.session.add(
            self.build_article(title="Existing story", slug="existing", author=user)
        )
        db.session.commit()
        before_users = db.session.execute(text("SELECT * FROM users ORDER BY id")).all()
        before_articles = db.session.execute(
            text("SELECT * FROM articles ORDER BY id")
        ).all()
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="c35e1fa43003")
            upgrade(directory=MIGRATIONS_DIRECTORY)
            self.assertEqual(
                db.session.execute(text("SELECT * FROM users ORDER BY id")).all(),
                before_users,
            )
            self.assertEqual(
                db.session.execute(text("SELECT * FROM articles ORDER BY id")).all(),
                before_articles,
            )
            self.assertTrue(
                check_password_hash(User.query.one().password_hash, "password123")
            )
            self.assertEqual(self.client.get("/existing").status_code, 200)
            db.session.remove()
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="c35e1fa43003")
            self.assertEqual(
                db.session.execute(text("SELECT * FROM users ORDER BY id")).all(),
                before_users,
            )
            self.assertEqual(
                db.session.execute(text("SELECT * FROM articles ORDER BY id")).all(),
                before_articles,
            )
        finally:
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def test_user_field_migration_refuses_invalid_existing_users(self):
        self.create_user()
        valid_values = {
            "username": "Legacy Author",
            "email": "legacy@example.test",
            "password": generate_password_hash("legacy-password"),
        }
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="c35e1fa43003")
            for column in valid_values:
                for value in (None, "", "   ", " \t\n\r\f\v "):
                    with self.subTest(column=column, value=value):
                        invalid_user_id = db.session.execute(
                            User.__table__.insert()
                            .values({**valid_values, column: value})
                            .returning(User.id)
                        ).scalar_one()
                        db.session.commit()
                        before = db.session.execute(
                            text("SELECT * FROM users ORDER BY id")
                        ).all()
                        db.session.remove()
                        try:
                            with self.assertRaisesRegex(
                                DBAPIError, "Cannot enforce required user fields"
                            ):
                                upgrade(directory=MIGRATIONS_DIRECTORY)
                            self.assertEqual(
                                db.session.execute(
                                    text("SELECT version_num FROM alembic_version")
                                ).scalar_one(),
                                "c35e1fa43003",
                            )
                            self.assertEqual(
                                db.session.execute(
                                    text("SELECT * FROM users ORDER BY id")
                                ).all(),
                                before,
                            )
                        finally:
                            db.session.rollback()
                            db.session.execute(
                                User.__table__.delete().where(
                                    User.id == invalid_user_id
                                )
                            )
                            db.session.commit()
                            db.session.remove()
        finally:
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def test_tag_associations_enforce_unique_pairs_and_valid_references(self):
        tag = Tag(slug="python", name="Python")
        article = self.build_article(slug="tagged-story", tags=[tag])
        db.session.add(article)
        db.session.commit()
        for article_id, tag_id in (
            (article.id, tag.id),
            (-1, tag.id),
            (article.id, -1),
        ):
            with self.subTest(article_id=article_id, tag_id=tag_id):
                with self.assertRaises(IntegrityError):
                    db.session.execute(
                        article_tags.insert().values(
                            article_id=article_id, tag_id=tag_id
                        )
                    )
                    db.session.commit()
                db.session.rollback()
        self.assertEqual(
            db.session.execute(db.select(article_tags)).all(), [(article.id, tag.id)]
        )

    def test_tag_deletion_cascades_only_to_associations(self):
        shared = Tag(slug="python", name="Python")
        other = Tag(slug="flask", name="Flask")
        first = self.build_article(slug="first", tags=[shared, other])
        second = self.build_article(slug="second", tags=[shared])
        db.session.add_all([first, second])
        db.session.commit()
        first_id, shared_id = first.id, shared.id
        db.session.execute(
            text("DELETE FROM articles WHERE id = :id"), {"id": first_id}
        )
        db.session.commit()
        self.assertEqual(Tag.query.count(), 2)
        self.assertEqual(second.tags, [shared])
        db.session.execute(text("DELETE FROM tags WHERE id = :id"), {"id": shared_id})
        db.session.commit()
        self.assertEqual(Article.query.count(), 1)
        self.assertEqual(second.tags, [])
        self.assertEqual(Tag.query.one().slug, "flask")

    def test_tag_constraints_reject_duplicate_slugs_and_blank_values(self):
        db.session.add(Tag(slug="python", name="Python"))
        db.session.commit()
        for values in (
            {"slug": "python", "name": "Duplicate"},
            {"slug": "", "name": "Empty slug"},
            {"slug": "blank", "name": " "},
            {"slug": "missing", "name": None},
        ):
            with self.subTest(values=values):
                db.session.add(Tag(**values))
                with self.assertRaises(IntegrityError):
                    db.session.commit()
                db.session.rollback()
        self.assertEqual(Tag.query.count(), 1)

    def test_tag_migration_preserves_existing_articles(self):
        user = self.create_user()
        db.session.add(
            self.build_article(title="Existing article", slug="existing", author=user)
        )
        db.session.commit()
        before = db.session.execute(text("SELECT * FROM articles ORDER BY id")).all()
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="b24d0f932002")
            upgrade(directory=MIGRATIONS_DIRECTORY)
            after = db.session.execute(text("SELECT * FROM articles ORDER BY id")).all()
            self.assertEqual(after, before)
            self.assertEqual(Article.query.one().tags, [])
            self.assertEqual(Tag.query.count(), 0)
        finally:
            db.session.rollback()
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def test_category_slugs_are_unique(self):
        db.session.add(Category(slug="tech", name="Another tech category"))
        with self.assertRaises(IntegrityError):
            db.session.commit()
        db.session.rollback()
        self.assertEqual(Category.query.filter_by(slug="tech").one().name, "Tech")

    def test_category_migrations_preserve_existing_articles(self):
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="b5c595757bd0")
            db.session.execute(
                text(
                    "INSERT INTO articles (slug, title, description, text, category, img_url) "
                    "VALUES (:slug, 'Old story', 'Original description', 'Original body', :category, 'old.webp')"
                ),
                [
                    {"slug": "old-story", "category": "tech"},
                    {"slug": "custom-topic", "category": "science"},
                    {"slug": "no-category", "category": None},
                ],
            )
            original_rows = (
                db.session.execute(text("SELECT * FROM articles ORDER BY id"))
                .mappings()
                .all()
            )
            db.session.commit()
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)
            self.assertEqual(
                {category.slug for category in Category.query.all()},
                {"design", "tech", "mobile", "science"},
            )
            article = Article.query.filter_by(slug="old-story").one()
            self.assertEqual(article.body, "Original body")
            self.assertEqual(article.image_filename, "old.webp")
            self.assertEqual(article.category.slug, "tech")
            self.assertEqual(
                Article.query.filter_by(slug="custom-topic").one().category.slug,
                "science",
            )
            self.assertIsNone(
                Article.query.filter_by(slug="no-category").one().category
            )
            db.session.remove()
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="b5c595757bd0")
            restored_rows = (
                db.session.execute(text("SELECT * FROM articles ORDER BY id"))
                .mappings()
                .all()
            )
            self.assertEqual(restored_rows, original_rows)
        finally:
            db.session.rollback()
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

    def test_category_downgrade_refuses_to_truncate_slugs(self):
        category = Category(slug="long-category-slug", name="Long category")
        db.session.add(
            self.build_article(slug="long-category-article", category=category)
        )
        db.session.commit()
        db.session.remove()
        with self.assertRaisesRegex(DBAPIError, "exceeds the old 10-character limit"):
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="a13c9e821001")
        self.assertEqual(Article.query.one().category.slug, "long-category-slug")

    def test_article_categories_come_from_database(self):
        self.create_user()
        self.login()
        category = Category(slug="science", name="Science & Research")
        db.session.add(category)
        db.session.commit()
        form = self.client.get("/new-post").data
        self.assertIn(b'value="science"', form)
        self.assertIn(b"Science &amp; Research", form)
        invalid = self.post_form(
            "/new-post", data=self.article_data(category="science", body="")
        )
        self.assertIn(b'value="science" selected', invalid.data)
        response = self.post_form(
            "/new-post", data=self.article_data(category="science")
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Article.query.one().category_id, category.id)
        self.assertIn(b"Science &amp; Research", self.client.get("/").data)

    def test_category_relationship_enforces_references_and_restricts_deletion(self):
        db.session.add(self.build_article(slug="invalid-category", category_id=-1))
        with self.assertRaises(IntegrityError):
            db.session.commit()
        db.session.rollback()
        category = Category.query.filter_by(slug="tech").one()
        article = self.build_article(slug="classified-article", category=category)
        db.session.add(article)
        db.session.commit()
        self.assertEqual(category.articles, [article])
        db.session.delete(category)
        with self.assertRaises(IntegrityError):
            db.session.commit()
        db.session.rollback()
        self.assertEqual(Article.query.one().category.slug, "tech")

    def test_demo_seed_without_categories_rolls_back(self):
        Category.query.delete()
        db.session.commit()
        result = self.app.test_cli_runner().invoke(
            args=["seed-demo", "--count", "1"],
            input="demo-password\ndemo-password\n",
        )
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No categories found", result.output)
        self.assertEqual(User.query.count(), 0)
        self.assertEqual(Article.query.count(), 0)

    def test_demo_seed_is_repeatable_and_preserves_existing_data(self):
        existing_user = self.create_user()
        existing_hash = existing_user.password_hash
        runner = self.app.test_cli_runner()
        result = runner.invoke(
            args=["seed-demo", "--count", "3"], input="demo-password\ndemo-password\n"
        )
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(Article.query.count(), 3)
        self.assertEqual(User.query.count(), 2)
        demo_user = User.query.filter_by(email="demo@hummingbird.example").one()
        original_demo_hash = demo_user.password_hash
        self.assertTrue(check_password_hash(original_demo_hash, "demo-password"))
        self.assertTrue(
            all(article.author_id == demo_user.id for article in Article.query.all())
        )
        self.assertEqual(Tag.query.count(), 4)
        self.assertEqual(len(db.session.execute(db.select(article_tags)).all()), 6)
        for article in Article.query.all():
            self.assertEqual(len(article.tags), 2)
            self.assertEqual(self.client.get(f"/{article.slug}").status_code, 200)
        first_demo = Article.query.filter_by(slug="hummingbird-demo-001").one()
        first_demo.tags = [Tag(slug="personal", name="Personal")]
        first_demo.body = "My edited demo article"
        db.session.commit()
        existing_associations = set(db.session.execute(db.select(article_tags)).all())
        result = runner.invoke(args=["seed-demo", "--count", "3"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Created 0 articles", result.output)
        self.assertEqual(Article.query.count(), 3)
        self.assertEqual(Tag.query.count(), 5)
        self.assertEqual(
            set(db.session.execute(db.select(article_tags)).all()),
            existing_associations,
        )
        first_demo = Article.query.filter_by(slug="hummingbird-demo-001").one()
        self.assertEqual(first_demo.body, "My edited demo article")
        self.assertEqual([tag.slug for tag in first_demo.tags], ["personal"])
        self.assertEqual(
            User.query.filter_by(email="demo@hummingbird.example").one().password_hash,
            original_demo_hash,
        )
        self.assertEqual(
            User.query.filter_by(email="author@example.test").one().password_hash,
            existing_hash,
        )
        result = runner.invoke(args=["seed-demo", "--count", "4"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Created 1 articles", result.output)
        self.assertEqual(Tag.query.count(), 5)
        self.assertTrue(
            existing_associations.issubset(
                set(db.session.execute(db.select(article_tags)).all())
            )
        )
        self.assertEqual(
            {
                tag.slug
                for tag in Article.query.filter_by(slug="hummingbird-demo-004")
                .one()
                .tags
            },
            {"getting-started", "tutorials"},
        )

    def test_demo_seed_reuses_email_variants_without_changing_credentials(self):
        user = self.create_user(email=" \tDEMO@Hummingbird.Example\r\n")
        user_id, stored_email, password_hash = user.id, user.email, user.password_hash
        result = self.app.test_cli_runner().invoke(args=["seed-demo", "--count", "2"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Existing demo account reused", result.output)
        self.assertEqual(User.query.count(), 1)
        user = User.query.one()
        self.assertEqual(
            (user.id, user.email, user.password_hash),
            (user_id, stored_email, password_hash),
        )
        self.assertEqual(
            [article.author_id for article in Article.query.all()], [user_id, user_id]
        )

    def test_existing_database_column_names_remain_readable(self):
        password_hash = generate_password_hash("legacy-password")
        user_id = db.session.execute(
            text(
                "INSERT INTO users (username, email, password) VALUES (:name, :email, :password) RETURNING id"
            ),
            {
                "name": "Existing Author",
                "email": "existing@example.test",
                "password": password_hash,
            },
        ).scalar_one()
        db.session.execute(
            text(
                "INSERT INTO articles (title, slug, description, text, img_url, author_id) "
                "VALUES (:title, :slug, :description, :body, :image, :author_id)"
            ),
            {
                "title": "Existing article",
                "slug": "original-url",
                "description": "Existing description",
                "body": "Existing body",
                "image": "original-image.webp",
                "author_id": user_id,
            },
        )
        db.session.commit()
        user = db.session.get(User, user_id)
        self.assertTrue(check_password_hash(user.password_hash, "legacy-password"))
        response = self.client.get("/original-url")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Existing body", response.data)
        self.assertIn(b"/static/images/uploads/original-image.webp", response.data)
        self.assertIn(b"Existing Author", self.client.get("/").data)

    def test_seed_failure_rolls_back_new_demo_user(self):
        def reject_insert(mapper, connection, article):
            article.author_id = -1

        event.listen(Article, "before_insert", reject_insert)
        try:
            with self.assertLogs(self.app.logger, level="ERROR"):
                result = self.app.test_cli_runner().invoke(
                    args=["seed-demo", "--count", "1"],
                    input="demo-password\ndemo-password\n",
                )
        finally:
            event.remove(Article, "before_insert", reject_insert)
        self.assertNotEqual(result.exit_code, 0)
        self.assertEqual(User.query.count(), 0)
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(Tag.query.count(), 0)
        self.assertEqual(db.session.execute(db.select(article_tags)).all(), [])

    def test_registration_validation(self):
        data = {
            "register_name": "Author",
            "register_email": "author@example.test",
            "register_password": "password123",
            "register_password_confirmation": "password123",
        }
        for field, value in [
            ("register_name", "   "),
            ("register_email", "invalid"),
            ("register_email", "author name@example.test"),
            ("register_password_confirmation", "different"),
            ("register_name", "x" * 81),
        ]:
            with self.subTest(field=field):
                response = self.post_form(
                    "/auth/register", data={**data, field: value}, follow_redirects=True
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(User.query.count(), 0)
        self.create_user()
        response = self.post_form("/auth/register", data=data, follow_redirects=True)
        self.assertIn(b"already registered", response.data)
        self.assertEqual(User.query.count(), 1)

    def test_authentication_errors_return_to_article(self):
        user = self.create_user()
        db.session.add(
            self.build_article(
                title="Story", slug="story", body="Body", author_id=user.id
            )
        )
        db.session.commit()
        response = self.post_form(
            "/auth/login", data={"return_to": "/story"}, follow_redirects=True
        )
        self.assertEqual(response.request.path, "/story")
        self.assertIn(b"Please fill out all fields", response.data)
        self.assertIn(b"/auth/register", response.data)

    def test_authentication_redirect_cannot_leave_the_site(self):
        for target in [
            "https://example.com",
            "//example.com",
            "/\\example.com",
            "/new-post",
        ]:
            with self.subTest(target=target):
                response = self.post_form("/auth/login", data={"return_to": target})
                self.assertEqual(response.location, "/")


if __name__ == "__main__":
    unittest.main()
