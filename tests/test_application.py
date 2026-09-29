import io
import os
import re
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from html import unescape
from pathlib import Path
from threading import Barrier
from time import time
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from flask_migrate import downgrade, upgrade
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError, SQLAlchemyError
from werkzeug.datastructures import FileStorage
from werkzeug.security import check_password_hash, generate_password_hash

from app import create_app
from app.articles.models import Article, Category, Tag, article_tags
from app.articles.queries import get_owned_article
from app.articles.search import article_matches_search
from app.articles.uploads import MAX_IMAGE_BYTES
from app.extensions import db
from app.users.models import User
from app.users.queries import get_user_by_email
from tests.test_uploads import image_bytes

PNG = image_bytes()
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

    def publish_first_article(self):
        self.create_user()
        self.login()
        response = self.post_form(
            "/new-post", data=self.article_data(tags="Python, Web")
        )
        self.assertEqual(response.status_code, 302)
        return Article.query.one()

    def edit_data(self, **overrides):
        data = {
            "article_id": "1",
            "version": "1",
            "title": "Updated article",
            "description": "Updated description",
            "body": "Updated body",
            "category": "design",
            "tags": "Python, Databases",
        }
        data.update(overrides)
        return data

    def deletion_data(self, **overrides):
        return {"article_id": "1", "version": "1", "confirm_delete": "yes", **overrides}

    def form_version(self, response):
        match = re.search(rb'name="version" value="([^"]*)"', response.data)
        self.assertIsNotNone(match)
        return match.group(1).decode("ascii")

    def database_rows(self, table, *, exclude=()):
        return [
            {key: value for key, value in row.items() if key not in exclude}
            for row in db.session.execute(
                text(f"SELECT * FROM {table} ORDER BY 1, 2")
            ).mappings()
        ]

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
        self.post_form("/new-post", data=self.article_data())
        pages.append(self.client.get("/first-article/edit"))
        pages.append(self.client.get("/first-article/delete"))
        forms = {}
        for page in pages:
            self.assertEqual(page.status_code, 200)
            forms.update(
                re.findall(
                    rb'<form\b(?=[^>]*\bmethod="post")[^>]*action="([^"]+)"[^>]*>(.*?)</form>',
                    page.data,
                    flags=re.DOTALL,
                )
            )
        self.assertEqual(
            set(forms),
            {
                b"/auth/register",
                b"/auth/login",
                b"/new-post",
                b"/logout",
                b"/first-article/edit",
                b"/first-article/delete",
            },
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

    def test_edit_form_prefills_saved_values_and_does_not_change_data(self):
        article = self.publish_first_article()
        before = db.session.execute(text("SELECT * FROM articles")).all()
        response = self.client.get("/first-article/edit")
        self.assertEqual(response.status_code, 200)
        for value in (
            b'value="First article"',
            b"A description",
            b"Article body",
            b'value="tech" selected',
            b'value="Python, Web"',
            b'name="version" value="1"',
            b'name="article_id" value="1"',
            b"Save Changes",
        ):
            self.assertIn(value, response.data)
        self.assertIn(b"/first-article/edit", self.client.get("/first-article").data)
        self.assertEqual(
            db.session.execute(text("SELECT * FROM articles")).all(), before
        )
        self.assertEqual(len(list(Path(self.uploads.name).iterdir())), 1)
        self.assertEqual(article.slug, "first-article")

    def test_owner_edit_updates_content_and_relations_but_preserves_identity(self):
        article = self.publish_first_article()
        identity = (
            article.id,
            article.slug,
            article.author_id,
            article.created_at,
            article.image_filename,
        )
        image = (Path(self.uploads.name) / article.image_filename).read_bytes()
        shared = self.build_article(
            slug="shared", author_id=article.author_id, tags=list(article.tags)
        )
        db.session.add(shared)
        db.session.commit()
        response = self.post_form(
            "/first-article/edit",
            data=self.edit_data(
                title="  logout  ",
                slug="changed",
                author_id="999",
                created_at="2000-01-01",
                image_filename="other.png",
                id="999",
            ),
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/first-article")
        db.session.expire_all()
        self.assertEqual(
            (
                article.id,
                article.slug,
                article.author_id,
                article.created_at,
                article.image_filename,
            ),
            identity,
        )
        self.assertEqual(
            (article.title, article.description, article.body),
            ("logout", "Updated description", "Updated body"),
        )
        self.assertEqual(article.category.slug, "design")
        self.assertEqual(article.version, 2)
        self.assertEqual({tag.slug for tag in article.tags}, {"python", "databases"})
        self.assertEqual({tag.slug for tag in shared.tags}, {"python", "web"})
        self.assertEqual(Tag.query.count(), 3)
        self.assertEqual(
            (Path(self.uploads.name) / article.image_filename).read_bytes(), image
        )
        self.assertIn(b"Updated body", self.client.get("/first-article").data)
        self.assertIn(
            b"logout", self.client.get("/?category=design&tag=databases").data
        )
        self.assertNotIn(b"logout</a>", self.client.get("/?category=tech").data)

    def test_edit_can_remove_all_tag_links_without_deleting_tags(self):
        article = self.publish_first_article()
        tag_ids = {tag.id for tag in article.tags}
        response = self.post_form("/first-article/edit", data=self.edit_data(tags=""))
        self.assertEqual(response.status_code, 302)
        db.session.expire_all()
        self.assertEqual(article.tags, [])
        self.assertEqual({tag.id for tag in Tag.query.all()}, tag_ids)
        self.assertEqual(db.session.execute(db.select(article_tags)).all(), [])

    def test_only_the_owner_can_open_or_submit_article_edits(self):
        article = self.publish_first_article()
        self.create_user(email="other@example.test")
        db.session.add(self.build_article(slug="unowned"))
        db.session.commit()
        before = db.session.execute(text("SELECT * FROM articles ORDER BY id")).all()
        original_tags = {tag.id for tag in article.tags}
        original_files = set(Path(self.uploads.name).iterdir())
        self.post_form("/logout")
        self.assertEqual(self.client.get("/first-article/edit").status_code, 401)
        self.assertEqual(
            self.post_form("/first-article/edit", data=self.edit_data()).status_code,
            401,
        )
        self.assertNotIn(b"/first-article/edit", self.client.get("/first-article").data)
        self.post_form(
            "/auth/login",
            data={"login_email": "other@example.test", "login_password": "password123"},
        )
        for slug in ("first-article", "unowned", "missing"):
            with self.subTest(slug=slug):
                self.assertEqual(self.client.get(f"/{slug}/edit").status_code, 404)
                self.assertEqual(
                    self.post_form(f"/{slug}/edit", data=self.edit_data()).status_code,
                    404,
                )
        self.assertNotIn(b"/first-article/edit", self.client.get("/first-article").data)
        self.assertEqual(
            db.session.execute(text("SELECT * FROM articles ORDER BY id")).all(), before
        )
        self.assertEqual({tag.id for tag in article.tags}, original_tags)
        self.assertEqual(set(Path(self.uploads.name).iterdir()), original_files)
        self.assertEqual(Tag.query.count(), 2)

    def test_edit_rejects_invalid_fields_and_preserves_submitted_values(self):
        self.publish_first_article()
        before = db.session.execute(text("SELECT * FROM articles")).all()
        before_links = db.session.execute(db.select(article_tags)).all()
        for overrides in (
            {"title": " "},
            {"title": "x" * 56},
            {"description": ""},
            {"description": "x" * 251},
            {"body": " "},
            {"category": "missing"},
            {"tags": "<script>"},
            {"tags": "a,b,c,d,e,f"},
        ):
            with self.subTest(overrides=overrides):
                response = self.post_form(
                    "/first-article/edit", data=self.edit_data(**overrides)
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn(b"Save Changes", response.data)
                if "title" not in overrides:
                    self.assertIn(b'value="Updated article"', response.data)
                self.assertEqual(
                    db.session.execute(text("SELECT * FROM articles")).all(), before
                )
                self.assertEqual(
                    db.session.execute(db.select(article_tags)).all(), before_links
                )
                self.assertEqual(Tag.query.count(), 2)
                self.assertEqual(len(list(Path(self.uploads.name).iterdir())), 1)

    def test_edit_rejects_missing_invalid_and_other_session_csrf_tokens(self):
        self.publish_first_article()
        before = db.session.execute(text("SELECT * FROM articles")).all()
        with self.app.app_context():
            foreign_token = self.csrf_token(client=self.app.test_client())
        for token in (None, "invalid-token", foreign_token):
            with self.subTest(token=token):
                data = self.edit_data(image=(io.BytesIO(PNG), "replacement.png"))
                if token is not None:
                    data["csrf_token"] = token
                response = self.client.post("/first-article/edit", data=data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(b"Your form could not be verified", response.data)
        self.assertEqual(
            db.session.execute(text("SELECT * FROM articles")).all(), before
        )
        self.assertEqual(Tag.query.count(), 2)

    def test_edit_database_failure_rolls_back_content_and_tag_changes(self):
        self.publish_first_article()
        before = db.session.execute(text("SELECT * FROM articles")).all()
        before_links = db.session.execute(db.select(article_tags)).all()

        def fail_update(mapper, connection, article):
            connection.execute(text("SELECT 1 / 0"))

        event.listen(Article, "before_update", fail_update)
        try:
            with self.assertLogs(self.app.logger, level="ERROR"):
                response = self.post_form(
                    "/first-article/edit",
                    data=self.edit_data(image=(io.BytesIO(PNG), "replacement.png")),
                )
        finally:
            event.remove(Article, "before_update", fail_update)
        self.assertEqual(response.status_code, 500)
        self.assertIn(b"Unable to save your changes", response.data)
        self.assertIn(b'value="Updated article"', response.data)
        self.assertNotIn(b"SELECT 1 / 0", response.data)
        self.assertEqual(
            db.session.execute(text("SELECT * FROM articles")).all(), before
        )
        self.assertEqual(
            db.session.execute(db.select(article_tags)).all(), before_links
        )
        self.assertEqual(Tag.query.count(), 2)
        self.assertEqual(len(list(Path(self.uploads.name).iterdir())), 1)
        self.assertEqual(
            self.post_form("/first-article/edit", data=self.edit_data()).status_code,
            302,
        )

    def test_stale_edit_preserves_draft_and_requires_review_before_retrying(self):
        self.publish_first_article()
        old_version = self.form_version(self.client.get("/first-article/edit"))
        saved = self.post_form("/first-article/edit", data=self.edit_data())
        self.assertEqual(saved.status_code, 302)
        tables = ("articles", "tags", "article_tags")
        before = {table: self.database_rows(table) for table in tables}
        files = {
            item.name: item.read_bytes() for item in Path(self.uploads.name).iterdir()
        }
        draft = self.edit_data(
            version=old_version,
            title="Draft <title>",
            description="My draft description",
            body="My unsaved <script>alert(1)</script> text",
            category="mobile",
            tags="Unpublished",
        )
        for _ in range(2):
            response = self.post_form(
                "/first-article/edit",
                data={**draft, "image": (io.BytesIO(PNG), "draft.png")},
            )
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.form_version(response), old_version)
            for value in (
                b"Your changes have not been saved",
                b'value="Draft &lt;title&gt;"',
                b"My draft description",
                b"My unsaved &lt;script&gt;alert(1)&lt;/script&gt; text",
                b'value="mobile" selected',
                b'value="Unpublished"',
                b'href="/first-article/edit" target="_blank" rel="noopener"',
                b"select it again before saving",
            ):
                self.assertIn(value, response.data)
            self.assertEqual(
                {table: self.database_rows(table) for table in tables}, before
            )
            self.assertEqual(
                {
                    item.name: item.read_bytes()
                    for item in Path(self.uploads.name).iterdir()
                },
                files,
            )
        latest = self.client.get("/first-article/edit")
        self.assertIn(b'value="Updated article"', latest.data)
        self.assertEqual(self.form_version(latest), "2")
        response = self.post_form(
            "/first-article/edit",
            data={**draft, "version": self.form_version(latest)},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Article.query.one().title, draft["title"])
        self.assertEqual(Article.query.one().version, 3)

    def test_tag_only_cover_only_and_unchanged_saves_invalidate_older_forms(self):
        article = self.publish_first_article()
        for overrides in (
            {"tags": "Only tags changed"},
            {"image": (io.BytesIO(PNG), "new-cover.png")},
            {},
        ):
            with self.subTest(fields=tuple(overrides)):
                version = article.version
                data = self.edit_data(
                    version=str(version),
                    title=article.title,
                    description=article.description,
                    body=article.body,
                    category=article.category.slug,
                    tags=", ".join(tag.name for tag in article.tags),
                )
                saved = self.post_form(
                    "/first-article/edit", data={**data, **overrides}
                )
                self.assertEqual(saved.status_code, 302)
                self.assertEqual(article.version, version + 1)
                before = self.database_rows("articles")
                # A conflict takes precedence even when the old draft is invalid.
                stale = self.post_form(
                    "/first-article/edit", data={**data, "title": ""}
                )
                self.assertEqual(stale.status_code, 409)
                self.assertEqual(self.database_rows("articles"), before)

    def test_edit_requires_a_valid_version_without_saving_files_or_tags(self):
        self.publish_first_article()
        before = self.database_rows("articles")
        files = set(Path(self.uploads.name).iterdir())
        for version in (None, "", "0", "-1", "1.0", "+1", " 1 ", "abc", "1" * 5000):
            with self.subTest(version=version):
                data = self.edit_data(image=(io.BytesIO(PNG), "replacement.png"))
                if version is None:
                    del data["version"]
                else:
                    data["version"] = version
                response = self.post_form("/first-article/edit", data=data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(b"article version is missing or invalid", response.data)
                self.assertIn(b'value="Updated article"', response.data)
                self.assertEqual(self.database_rows("articles"), before)
                self.assertEqual(set(Path(self.uploads.name).iterdir()), files)
                self.assertEqual(Tag.query.count(), 2)
        future = self.post_form(
            "/first-article/edit", data=self.edit_data(version="99")
        )
        self.assertEqual(future.status_code, 409)
        self.assertEqual(self.database_rows("articles"), before)

    def test_validation_error_does_not_refresh_an_edit_forms_version(self):
        self.publish_first_article()
        invalid = self.post_form("/first-article/edit", data=self.edit_data(title=""))
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(self.form_version(invalid), "1")
        saved = self.post_form("/first-article/edit", data=self.edit_data())
        self.assertEqual(saved.status_code, 302)
        retry = self.post_form(
            "/first-article/edit",
            data=self.edit_data(
                version=self.form_version(invalid), title="Fixed draft"
            ),
        )
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(self.form_version(retry), "1")
        self.assertEqual(Article.query.one().title, "Updated article")
        self.assertEqual(Article.query.one().version, 2)

    def test_concurrent_edits_keep_article_content_tags_and_cover_together(self):
        self.publish_first_article()
        db.session.remove()
        start = Barrier(2)
        covers = {1: image_bytes(color="blue"), 2: image_bytes(color="green")}

        def synchronize_lookup(slug, **kwargs):
            if kwargs.get("for_update"):
                start.wait(timeout=10)
            return get_owned_article(slug, **kwargs)

        def edit(number):
            with self.app.test_client() as client:
                self.assertEqual(
                    self.post_form(
                        "/auth/login",
                        client=client,
                        data={
                            "login_email": "author@example.test",
                            "login_password": "password123",
                        },
                    ).status_code,
                    302,
                )
                version = self.form_version(client.get("/first-article/edit"))
                return self.post_form(
                    "/first-article/edit",
                    client=client,
                    data=self.edit_data(
                        version=version,
                        title=f"Update {number}",
                        tags=f"Topic {number}",
                        image=(io.BytesIO(covers[number]), "replacement.png"),
                    ),
                ).status_code

        with patch(
            "app.articles.routes.get_owned_article", side_effect=synchronize_lookup
        ):
            with ThreadPoolExecutor(max_workers=2) as executor:
                responses = list(executor.map(edit, (1, 2)))
        self.assertEqual(sorted(responses), [302, 409])
        article = Article.query.one()
        number = article.title.rsplit(" ", 1)[1]
        self.assertEqual(responses[int(number) - 1], 302)
        self.assertEqual(article.version, 2)
        self.assertEqual([tag.slug for tag in article.tags], [f"topic-{number}"])
        self.assertEqual(
            {tag.slug for tag in Tag.query.all()}, {"python", "web", f"topic-{number}"}
        )
        self.assertEqual(len(db.session.execute(db.select(article_tags)).all()), 1)
        self.assertEqual(
            (Path(self.uploads.name) / article.image_filename).read_bytes(),
            covers[int(number)],
        )
        self.assertEqual(
            {item.name for item in Path(self.uploads.name).iterdir()},
            {article.image_filename},
        )

    def test_cover_replacement_removes_old_file_only_after_commit(self):
        article = self.publish_first_article()
        previous_file = Path(self.uploads.name) / article.image_filename
        replacement = image_bytes("WEBP", color="blue")
        commit = db.session.commit

        def checked_commit():
            self.assertTrue(previous_file.exists())
            commit()
            self.assertTrue(previous_file.exists())

        with patch.object(db.session, "commit", side_effect=checked_commit):
            response = self.post_form(
                "/first-article/edit",
                data=self.edit_data(
                    image=(io.BytesIO(replacement), "replacement.webp")
                ),
            )
        self.assertEqual(response.status_code, 302)
        db.session.expire_all()
        self.assertEqual(article.title, "Updated article")
        self.assertTrue(article.image_filename.endswith(".webp"))
        self.assertEqual(
            (Path(self.uploads.name) / article.image_filename).read_bytes(), replacement
        )
        self.assertFalse(previous_file.exists())
        self.assertEqual(len(list(Path(self.uploads.name).iterdir())), 1)
        self.assertIn(
            article.image_filename.encode(), self.client.get("/first-article").data
        )
        form = self.client.get("/first-article/edit").data
        self.assertIn(b'alt="Current cover"', form)
        self.assertIn(b"Replace cover image (optional)", form)

    def test_empty_replacement_keeps_cover_and_placeholder_can_gain_cover(self):
        article = self.publish_first_article()
        original_filename = article.image_filename
        response = self.post_form(
            "/first-article/edit", data=self.edit_data(image=(io.BytesIO(b""), ""))
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(article.image_filename, original_filename)
        placeholder = self.build_article(
            slug="placeholder", author_id=article.author_id
        )
        db.session.add(placeholder)
        db.session.commit()
        self.assertEqual(
            self.post_form(
                "/placeholder/edit", data=self.edit_data(article_id=str(placeholder.id))
            ).status_code,
            302,
        )
        self.assertIsNone(placeholder.image_filename)
        response = self.post_form(
            "/placeholder/edit",
            data=self.edit_data(
                article_id=str(placeholder.id),
                version="2",
                image=(io.BytesIO(PNG), "cover.png"),
            ),
        )
        self.assertEqual(response.status_code, 302)
        self.assertTrue((Path(self.uploads.name) / placeholder.image_filename).exists())
        self.assertTrue((Path(self.uploads.name) / original_filename).exists())

    def test_invalid_replacements_preserve_original_content_tags_and_file(self):
        article = self.publish_first_article()
        before = db.session.execute(text("SELECT * FROM articles")).all()
        original = Path(self.uploads.name) / article.image_filename
        for filename, contents in (
            ("fake.png", b"not an image"),
            ("wrong.jpg", PNG),
            ("large.png", PNG.ljust(MAX_IMAGE_BYTES + 1, b"\0")),
        ):
            with self.subTest(filename=filename):
                response = self.post_form(
                    "/first-article/edit",
                    data=self.edit_data(image=(io.BytesIO(contents), filename)),
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn(b'value="Updated article"', response.data)
                self.assertEqual(
                    db.session.execute(text("SELECT * FROM articles")).all(), before
                )
                self.assertEqual({tag.slug for tag in article.tags}, {"python", "web"})
                self.assertEqual(Tag.query.count(), 2)
                self.assertEqual(list(Path(self.uploads.name).iterdir()), [original])
                self.assertEqual(original.read_bytes(), PNG)

    def test_other_user_cannot_replace_article_cover(self):
        article = self.publish_first_article()
        original_filename = article.image_filename
        self.create_user(email="other@example.test")
        self.post_form(
            "/auth/login",
            data={"login_email": "other@example.test", "login_password": "password123"},
        )
        response = self.post_form(
            "/first-article/edit",
            data=self.edit_data(image=(io.BytesIO(PNG), "cover.png")),
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(Article.query.one().image_filename, original_filename)
        self.assertEqual(
            {item.name for item in Path(self.uploads.name).iterdir()},
            {original_filename},
        )

    def test_replacement_write_failure_preserves_original_and_removes_partial_file(
        self,
    ):
        article = self.publish_first_article()
        before = db.session.execute(text("SELECT * FROM articles")).all()
        original = Path(self.uploads.name) / article.image_filename

        def fail_write(upload, destination, buffer_size=16384):
            destination.write(b"partial image")
            raise OSError("Simulated disk failure")

        with (
            patch.object(FileStorage, "save", new=fail_write),
            self.assertLogs(self.app.logger, level="ERROR"),
        ):
            response = self.post_form(
                "/first-article/edit",
                data=self.edit_data(image=(io.BytesIO(PNG), "replacement.png")),
            )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            db.session.execute(text("SELECT * FROM articles")).all(), before
        )
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [original])
        self.assertEqual(original.read_bytes(), PNG)
        self.assertEqual(Tag.query.count(), 2)

    def test_shared_cover_is_removed_only_after_its_last_reference_is_replaced(self):
        article = self.publish_first_article()
        original = Path(self.uploads.name) / article.image_filename
        shared = self.build_article(
            slug="shared-cover",
            author_id=article.author_id,
            image_filename=article.image_filename,
        )
        db.session.add(shared)
        db.session.commit()
        for target in (article, shared):
            response = self.post_form(
                f"/{target.slug}/edit",
                data=self.edit_data(
                    article_id=str(target.id),
                    image=(io.BytesIO(PNG), "replacement.png"),
                ),
            )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(original.exists(), target.slug == "first-article")
        self.assertEqual(len(list(Path(self.uploads.name).iterdir())), 2)

    def test_cleanup_database_failure_does_not_undo_a_successful_replacement(self):
        article = self.publish_first_article()
        previous_filename = article.image_filename
        with (
            patch(
                "app.articles.services.is_image_referenced",
                side_effect=SQLAlchemyError("Reference check failed"),
            ),
            self.assertLogs("app.articles.services", level="ERROR"),
        ):
            response = self.post_form(
                "/first-article/edit",
                data=self.edit_data(image=(io.BytesIO(PNG), "replacement.png")),
            )
        self.assertEqual(response.status_code, 302)
        db.session.expire_all()
        self.assertNotEqual(article.image_filename, previous_filename)
        self.assertEqual(article.title, "Updated article")
        self.assertEqual(
            {item.name for item in Path(self.uploads.name).iterdir()},
            {article.image_filename, previous_filename},
        )

    def test_cleanup_cannot_delete_a_file_outside_uploads(self):
        article = self.publish_first_article()
        outside = Path(self.uploads.name).with_name(
            Path(self.uploads.name).name + "-outside.png"
        )
        outside.write_bytes(PNG)
        self.addCleanup(outside.unlink, missing_ok=True)
        article.image_filename = "../" + outside.name
        db.session.commit()
        with self.assertLogs("app.articles.services", level="ERROR"):
            response = self.post_form(
                "/first-article/edit",
                data=self.edit_data(image=(io.BytesIO(PNG), "replacement.png")),
            )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(outside.read_bytes(), PNG)
        self.assertTrue((Path(self.uploads.name) / article.image_filename).exists())

    def test_uncertain_commit_does_not_delete_a_referenced_replacement(self):
        self.publish_first_article()
        commit = db.session.commit

        def commit_then_fail():
            commit()
            raise SQLAlchemyError("Simulated lost commit acknowledgement")

        with (
            patch.object(db.session, "commit", side_effect=commit_then_fail),
            self.assertLogs(self.app.logger, level="ERROR"),
        ):
            response = self.post_form(
                "/first-article/edit",
                data=self.edit_data(image=(io.BytesIO(PNG), "replacement.png")),
            )
        self.assertEqual(response.status_code, 500)
        db.session.expire_all()
        article = Article.query.one()
        self.assertEqual(article.title, "Updated article")
        self.assertTrue((Path(self.uploads.name) / article.image_filename).exists())

    def test_delete_confirmation_and_cancel_do_not_change_any_data(self):
        self.publish_first_article()
        tables = ("users", "articles", "tags", "article_tags", "categories")
        before = {table: self.database_rows(table) for table in tables}
        files = set(Path(self.uploads.name).iterdir())
        response = self.client.get("/first-article/delete")
        self.assertEqual(response.status_code, 200)
        for value in (
            b"First article",
            b"This cannot be undone.",
            b'name="article_id" value="1"',
            b'name="version" value="1"',
            b'name="confirm_delete" value="yes" required',
            b"Delete permanently",
            b'href="/first-article" class="button">Cancel',
        ):
            self.assertIn(value, response.data)
        self.assertIn(b"/first-article/delete", self.client.get("/first-article").data)
        self.assertEqual({table: self.database_rows(table) for table in tables}, before)
        self.assertEqual(set(Path(self.uploads.name).iterdir()), files)

    def test_owner_deletion_removes_only_article_links_and_unused_cover_after_commit(
        self,
    ):
        article = self.publish_first_article()
        original = Path(self.uploads.name) / article.image_filename
        shared = self.build_article(
            slug="shared",
            author=article.author,
            category=article.category,
            tags=list(article.tags),
        )
        db.session.add(shared)
        db.session.commit()
        shared_id = shared.id
        retained = {
            table: self.database_rows(table)
            for table in ("users", "categories", "tags")
        }
        commit = db.session.commit

        def checked_commit():
            self.assertTrue(original.exists())
            commit()
            self.assertTrue(original.exists())

        with patch.object(db.session, "commit", side_effect=checked_commit):
            response = self.post_form(
                "/first-article/delete", data=self.deletion_data()
            )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/")
        self.assertIn(b"Article deleted.", self.client.get("/").data)
        self.assertEqual(Article.query.one().id, shared_id)
        self.assertEqual(
            {row.article_id for row in db.session.execute(db.select(article_tags))},
            {shared_id},
        )
        self.assertEqual(
            {table: self.database_rows(table) for table in retained}, retained
        )
        self.assertFalse(original.exists())
        for suffix in ("", "/edit", "/delete"):
            self.assertEqual(
                self.client.get("/first-article" + suffix).status_code, 404
            )
        self.assertEqual(
            self.post_form(
                "/first-article/delete", data=self.deletion_data()
            ).status_code,
            404,
        )
        self.assertEqual(
            self.post_form("/first-article/edit", data=self.edit_data()).status_code,
            404,
        )

    def test_deletion_requires_the_owner_and_csrf_protection(self):
        article = self.publish_first_article()
        self.create_user(email="other@example.test")
        db.session.add(self.build_article(slug="unowned"))
        db.session.commit()
        before = self.database_rows("articles")
        files = set(Path(self.uploads.name).iterdir())
        with self.app.app_context():
            foreign_token = self.csrf_token(client=self.app.test_client())
        for token in (None, "invalid", foreign_token):
            data = self.deletion_data()
            if token is not None:
                data["csrf_token"] = token
            response = self.client.post("/first-article/delete", data=data)
            self.assertEqual(response.status_code, 400)
            self.assertIn(b"Your form could not be verified", response.data)
        self.post_form("/logout")
        self.assertEqual(self.client.get("/first-article/delete").status_code, 401)
        self.assertEqual(
            self.post_form(
                "/first-article/delete", data=self.deletion_data()
            ).status_code,
            401,
        )
        self.assertNotIn(
            b"/first-article/delete", self.client.get("/first-article").data
        )
        self.post_form(
            "/auth/login",
            data={"login_email": "other@example.test", "login_password": "password123"},
        )
        for slug in ("first-article", "unowned", "missing"):
            self.assertEqual(self.client.get(f"/{slug}/delete").status_code, 404)
            self.assertEqual(
                self.post_form(
                    f"/{slug}/delete", data=self.deletion_data()
                ).status_code,
                404,
            )
        self.assertNotIn(
            b"/first-article/delete", self.client.get("/first-article").data
        )
        self.assertEqual(self.database_rows("articles"), before)
        self.assertEqual(set(Path(self.uploads.name).iterdir()), files)
        self.assertEqual(len(article.tags), 2)

    def test_deletion_rejects_unconfirmed_or_invalid_submissions(self):
        self.publish_first_article()
        before = self.database_rows("articles")
        links = self.database_rows("article_tags")
        files = set(Path(self.uploads.name).iterdir())
        for field, values, status in (
            ("confirm_delete", (None, "", "no", "on"), 400),
            ("version", (None, "", "0", "-1", "1.0", "abc", "1" * 5000), 400),
            ("article_id", (None, "", "999", "1.0"), 409),
            ("version", ("2",), 409),
        ):
            for value in values:
                with self.subTest(field=field, value=value):
                    data = self.deletion_data(**{field: value})
                    if value is None:
                        del data[field]
                    response = self.post_form("/first-article/delete", data=data)
                    self.assertEqual(response.status_code, status)
                    self.assertIn(b"First article", response.data)
                    self.assertEqual(self.database_rows("articles"), before)
                    self.assertEqual(self.database_rows("article_tags"), links)
                    self.assertEqual(set(Path(self.uploads.name).iterdir()), files)

    def test_stale_deletion_requires_a_fresh_confirmation_after_an_edit(self):
        self.publish_first_article()
        old = self.client.get("/first-article/delete")
        self.assertEqual(self.form_version(old), "1")
        saved = self.post_form(
            "/first-article/edit",
            data=self.edit_data(image=(io.BytesIO(PNG), "new.png")),
        )
        self.assertEqual(saved.status_code, 302)
        before = self.database_rows("articles")
        links = self.database_rows("article_tags")
        files = set(Path(self.uploads.name).iterdir())
        for _ in range(2):
            stale = self.post_form("/first-article/delete", data=self.deletion_data())
            self.assertEqual(stale.status_code, 409)
            self.assertIn(b"Nothing was deleted", stale.data)
            self.assertEqual(self.form_version(stale), "1")
            self.assertEqual(self.database_rows("articles"), before)
            self.assertEqual(self.database_rows("article_tags"), links)
            self.assertEqual(set(Path(self.uploads.name).iterdir()), files)
        fresh = self.client.get("/first-article/delete")
        self.assertEqual(self.form_version(fresh), "2")
        self.assertEqual(
            self.post_form(
                "/first-article/delete", data=self.deletion_data(version="2")
            ).status_code,
            302,
        )
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_old_edit_and_delete_forms_cannot_change_a_recreated_article(self):
        old_id = self.publish_first_article().id
        self.assertEqual(
            self.post_form(
                "/first-article/delete", data=self.deletion_data()
            ).status_code,
            302,
        )
        self.assertEqual(
            self.post_form("/new-post", data=self.article_data()).status_code, 302
        )
        replacement = Article.query.one()
        self.assertNotEqual(replacement.id, old_id)
        self.assertEqual(replacement.version, 1)
        before = self.database_rows("articles")
        files = set(Path(self.uploads.name).iterdir())
        for action, data in (
            ("edit", self.edit_data()),
            ("delete", self.deletion_data()),
        ):
            for article_id in (str(old_id), None):
                submitted = dict(data)
                if article_id is None:
                    del submitted["article_id"]
                response = self.post_form(f"/first-article/{action}", data=submitted)
                self.assertEqual(response.status_code, 409)
                self.assertIn(b"form no longer matches", response.data)
        self.assertEqual(self.database_rows("articles"), before)
        self.assertEqual(set(Path(self.uploads.name).iterdir()), files)
        fresh = self.client.get("/first-article/edit")
        self.assertIn(
            f'name="article_id" value="{replacement.id}"'.encode(), fresh.data
        )
        self.assertEqual(
            self.post_form(
                "/first-article/edit",
                data=self.edit_data(article_id=str(replacement.id)),
            ).status_code,
            302,
        )

    def test_failed_deletion_rolls_back_article_and_tag_links_and_keeps_cover(self):
        article = self.publish_first_article()
        before = self.database_rows("articles")
        links = self.database_rows("article_tags")
        original = Path(self.uploads.name) / article.image_filename

        def fail_delete(mapper, connection, target):
            connection.execute(text("SELECT 1 / 0"))

        event.listen(Article, "after_delete", fail_delete)
        try:
            with self.assertLogs(self.app.logger, level="ERROR"):
                response = self.post_form(
                    "/first-article/delete", data=self.deletion_data()
                )
        finally:
            event.remove(Article, "after_delete", fail_delete)
        self.assertEqual(response.status_code, 500)
        self.assertIn(b"Check the article list", response.data)
        self.assertNotIn(b"SELECT 1 / 0", response.data)
        self.assertNotIn(b"Delete permanently", response.data)
        self.assertEqual(self.database_rows("articles"), before)
        self.assertEqual(self.database_rows("article_tags"), links)
        self.assertEqual(original.read_bytes(), PNG)
        self.assertEqual(
            self.post_form(
                "/first-article/delete", data=self.deletion_data()
            ).status_code,
            302,
        )

    def test_deleting_a_shared_cover_keeps_it_until_the_last_article_is_deleted(self):
        article = self.publish_first_article()
        original = Path(self.uploads.name) / article.image_filename
        shared = self.build_article(
            slug="shared",
            author_id=article.author_id,
            image_filename=article.image_filename,
        )
        placeholder = self.build_article(
            slug="placeholder", author_id=article.author_id
        )
        db.session.add_all([shared, placeholder])
        db.session.commit()
        for target, keeps_file in (
            (article, True),
            (shared, False),
            (placeholder, False),
        ):
            response = self.post_form(
                f"/{target.slug}/delete",
                data=self.deletion_data(article_id=str(target.id)),
            )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(original.exists(), keeps_file)
        self.assertEqual(Article.query.count(), 0)

    def test_deletion_cleanup_failure_keeps_file_without_undoing_committed_delete(self):
        article = self.publish_first_article()
        original = Path(self.uploads.name) / article.image_filename
        with (
            patch(
                "app.articles.services.is_image_referenced",
                side_effect=SQLAlchemyError("Reference check failed"),
            ),
            self.assertLogs("app.articles.services", level="ERROR"),
        ):
            response = self.post_form(
                "/first-article/delete", data=self.deletion_data()
            )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(original.read_bytes(), PNG)

    def test_uncertain_delete_commit_shows_a_safe_error_without_reading_deleted_row(
        self,
    ):
        article = self.publish_first_article()
        original = Path(self.uploads.name) / article.image_filename
        commit = db.session.commit

        def commit_then_fail():
            commit()
            raise SQLAlchemyError("Simulated lost acknowledgement")

        with (
            patch.object(db.session, "commit", side_effect=commit_then_fail),
            self.assertLogs(self.app.logger, level="ERROR"),
        ):
            response = self.post_form(
                "/first-article/delete", data=self.deletion_data()
            )
        self.assertEqual(response.status_code, 500)
        self.assertIn(b"First article", response.data)
        self.assertIn(b"could not confirm whether", response.data)
        self.assertNotIn(b"Delete permanently", response.data)
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(original.read_bytes(), PNG)

    def run_competing_article_actions(self, actions):
        db.session.remove()
        start = Barrier(2)

        def synchronize_lookup(slug, **kwargs):
            if kwargs.get("for_update"):
                start.wait(timeout=10)
            return get_owned_article(slug, **kwargs)

        def submit(action):
            name, data = action
            with self.app.test_client() as client:
                self.assertEqual(
                    self.post_form(
                        "/auth/login",
                        client=client,
                        data={
                            "login_email": "author@example.test",
                            "login_password": "password123",
                        },
                    ).status_code,
                    302,
                )
                return self.post_form(
                    f"/first-article/{name}", client=client, data=data
                ).status_code

        with patch(
            "app.articles.routes.get_owned_article", side_effect=synchronize_lookup
        ):
            with ThreadPoolExecutor(max_workers=2) as executor:
                return list(executor.map(submit, actions))

    def test_two_simultaneous_deletions_remove_the_article_once(self):
        self.publish_first_article()
        statuses = self.run_competing_article_actions(
            [("delete", self.deletion_data()), ("delete", self.deletion_data())]
        )
        self.assertEqual(sorted(statuses), [302, 404])
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(self.database_rows("article_tags"), [])
        self.assertEqual(Tag.query.count(), 2)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_simultaneous_edit_and_deletion_cannot_lose_a_newer_save(self):
        self.publish_first_article()
        statuses = self.run_competing_article_actions(
            [
                ("edit", self.edit_data(image=(io.BytesIO(PNG), "replacement.png"))),
                ("delete", self.deletion_data()),
            ]
        )
        self.assertIn(statuses, ([302, 409], [404, 302]))
        if statuses[0] == 302:
            article = Article.query.one()
            self.assertEqual(article.title, "Updated article")
            self.assertEqual(article.version, 2)
            self.assertEqual(
                {tag.slug for tag in article.tags}, {"python", "databases"}
            )
            self.assertEqual(
                {item.name for item in Path(self.uploads.name).iterdir()},
                {article.image_filename},
            )
        else:
            self.assertEqual(Article.query.count(), 0)
            self.assertEqual(self.database_rows("article_tags"), [])
            self.assertEqual(Tag.query.count(), 2)
            self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

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
        for filename, contents, message in (
            ("bad.html", b"text", b"Unsupported image extension"),
            ("fake.png", b"text", b"valid, undamaged image"),
            ("mismatch.jpg", PNG, b"valid, undamaged image"),
            ("broken.png", PNG[:-15], b"valid, undamaged image"),
        ):
            with self.subTest(filename=filename):
                response = self.post_form(
                    "/new-post",
                    data=self.article_data(
                        image=(io.BytesIO(contents), filename), tags="Security"
                    ),
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn(message, response.data)
                self.assertIn(b'value="First article"', response.data)
                self.assertEqual(Article.query.count(), 0)
                self.assertEqual(Tag.query.count(), 0)
                self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_oversized_image_preserves_form_without_saving_data(self):
        self.create_user()
        self.login()
        response = self.post_form(
            "/new-post",
            data=self.article_data(
                image=(io.BytesIO(PNG.ljust(MAX_IMAGE_BYTES + 1, b"\0")), "large.png"),
                tags="Security",
            ),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"5 MiB or smaller", response.data)
        self.assertIn(b'value="First article"', response.data)
        self.assertIn(b'value="Security"', response.data)
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(Tag.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_oversized_request_is_rejected_before_form_parsing(self):
        self.create_user()
        self.login()
        token = self.csrf_token()
        body = b"x" * (self.app.config["MAX_CONTENT_LENGTH"] + 1)
        for endpoint in ("/new-post", "/auth/register", "/auth/login", "/logout"):
            with (
                self.subTest(endpoint=endpoint),
                patch.object(
                    self.app.request_class,
                    "_load_form_data",
                    side_effect=AssertionError("Oversized request must not be parsed"),
                ),
            ):
                response = self.client.post(
                    endpoint,
                    data=body,
                    content_type="application/x-www-form-urlencoded",
                    headers={"X-CSRFToken": token},
                )
            self.assertEqual(response.status_code, 413)
            self.assertIn(b"Your submission is too large", response.data)
            self.assertIn(b"6 MiB or smaller", response.data)
        self.assertEqual(User.query.count(), 1)
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(Tag.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])
        self.assertEqual(self.client.get("/new-post").status_code, 200)

    def test_unknown_length_stream_is_rejected_before_form_parsing(self):
        self.create_user()
        self.login()
        with patch.object(
            self.app.request_class,
            "_load_form_data",
            side_effect=AssertionError("Unbounded request must not be parsed"),
        ):
            response = self.client.post(
                "/new-post",
                data=self.article_data(tags="Security"),
                environ_overrides={"CONTENT_LENGTH": "", "wsgi.input_terminated": True},
            )
        self.assertEqual(response.status_code, 411)
        self.assertIn(b"Your submission size could not be checked", response.data)
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(Tag.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_exact_request_limit_is_accepted_and_one_byte_more_is_rejected(self):
        self.create_user()
        self.login()
        token = self.csrf_token()
        limit = self.app.config["MAX_CONTENT_LENGTH"]
        body = b"unused=" + b"x" * (limit - len("unused="))
        response = self.client.post(
            "/logout",
            data=body + b"x",
            content_type="application/x-www-form-urlencoded",
            headers={"X-CSRFToken": token},
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.get("/new-post").status_code, 200)
        response = self.client.post(
            "/logout",
            data=body,
            content_type="application/x-www-form-urlencoded",
            headers={"X-CSRFToken": token},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get("/new-post").status_code, 401)

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

    def test_search_matches_all_words_across_title_description_and_body(self):
        db.session.add_all(
            [
                self.build_article(slug="title-match", title="PostgreSQL notes"),
                self.build_article(
                    slug="description-match", description="PostgreSQL notes"
                ),
                self.build_article(slug="body-match", body="PostgreSQL notes"),
                self.build_article(
                    slug="split-match", title="PostgreSQL", description="Useful notes"
                ),
                self.build_article(slug="partial", title="PostgreSQL alone"),
                self.build_article(
                    slug="postgresql-notes",
                    tags=[Tag(slug="postgresql-notes", name="PostgreSQL notes")],
                ),
            ]
        )
        db.session.commit()
        response = self.client.get("/", query_string={"q": "  POSTGRESQL notes  "})
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"4 articles match", response.data)
        self.assertIn(b'value="POSTGRESQL notes"', response.data)
        for slug in ("title-match", "description-match", "body-match", "split-match"):
            self.assertIn(f'href="/{slug}"'.encode(), response.data)
        for slug in ("partial", "postgresql-notes"):
            self.assertNotIn(f'href="/{slug}"'.encode(), response.data)

    def test_search_uses_words_without_stemming_or_wildcards(self):
        db.session.add_all(
            [
                self.build_article(slug="accented", title="Café databases"),
                self.build_article(slug="singular", title="Cafe database"),
            ]
        )
        db.session.commit()
        for query, expected in (
            ("café", "accented"),
            ("cafe", "singular"),
            ("databases", "accented"),
            ("database", "singular"),
            ("database%", "singular"),
            ("data", None),
            ("%_!&", None),
        ):
            with self.subTest(query=query):
                response = self.client.get("/", query_string={"q": query})
                self.assertEqual(response.status_code, 200)
                for slug in ("accented", "singular"):
                    self.assertEqual(
                        f'href="/{slug}"'.encode() in response.data, slug == expected
                    )
                if expected is None:
                    self.assertIn(
                        b"No articles match your search and filters", response.data
                    )
        for query in ("", " \t\n "):
            response = self.client.get("/", query_string={"q": query})
            self.assertIn(b'href="/accented"', response.data)
            self.assertIn(b'href="/singular"', response.data)
            self.assertNotIn(b"articles match", response.data)

    def test_search_combines_filters_counts_and_pagination_and_preserves_links(self):
        tech = Category.query.filter_by(slug="tech").one()
        design = Category.query.filter_by(slug="design").one()
        python = Tag(slug="python", name="Python")
        sql = Tag(slug="sql", name="SQL")
        db.session.add_all(
            [
                self.build_article(
                    slug=f"matching-{number:02d}",
                    body="Needle database",
                    category=tech,
                    tags=[python, sql],
                )
                for number in range(14)
            ]
        )
        db.session.add_all(
            [
                self.build_article(
                    slug=f"design-{number}",
                    body="Needle database",
                    category=design,
                    tags=[python],
                )
                for number in range(3)
            ]
        )
        db.session.add_all(
            [
                self.build_article(
                    slug="no-tag", body="Needle database", category=design
                ),
                self.build_article(
                    slug="not-matching", body="Other text", category=tech, tags=[python]
                ),
                self.build_article(
                    slug="uncategorized", body="Needle database", tags=[python]
                ),
            ]
        )
        db.session.commit()
        params = {"q": "needle database", "category": "tech", "tag": "python"}
        first = self.client.get("/", query_string=params)
        self.assertEqual(first.status_code, 200)
        self.assertIn(b"14 articles match", first.data)
        self.assertIn(b"Tech (14)", first.data)
        self.assertIn(b"Design (3)", first.data)
        self.assertIn(b"Mobile (0)", first.data)
        for number in range(14):
            self.assertEqual(
                f'href="/matching-{number:02d}"'.encode() in first.data, number >= 2
            )
        self.assertLess(
            first.data.index(b'href="/matching-13"'),
            first.data.index(b'href="/matching-02"'),
        )

        def link_params(response, label):
            match = re.search(
                r'<a\b[^>]*href="([^"]+)"[^>]*>' + re.escape(label) + r"</a>",
                response.get_data(as_text=True),
            )
            self.assertIsNotNone(match, label)
            return {
                key: values[0]
                for key, values in parse_qs(
                    urlsplit(unescape(match.group(1))).query
                ).items()
            }

        self.assertEqual(link_params(first, "Next Page"), {**params, "page": "2"})
        self.assertEqual(link_params(first, "All"), {"q": params["q"], "tag": "python"})
        self.assertEqual(
            link_params(first, "Design (3)"), {**params, "category": "design"}
        )
        self.assertEqual(
            link_params(first, "Clear tag filter"),
            {"q": params["q"], "category": "tech"},
        )
        self.assertEqual(
            link_params(first, "Clear search"), {"category": "tech", "tag": "python"}
        )
        self.assertEqual(link_params(first, "SQL"), {**params, "tag": "sql"})
        form = re.search(
            rb'<form method="get".*?</form>', first.data, re.DOTALL
        ).group()
        self.assertIn(b'name="category" value="tech"', form)
        self.assertIn(b'name="tag" value="python"', form)
        self.assertNotIn(b'name="page"', form)
        second = self.client.get("/", query_string={**params, "page": "2"})
        self.assertEqual(second.status_code, 200)
        self.assertEqual(link_params(second, "Previous Page"), {**params, "page": "1"})
        self.assertIn(b'href="/matching-00"', second.data)
        self.assertIn(b'href="/matching-01"', second.data)
        self.assertNotIn(b'href="/matching-02"', second.data)
        self.assertEqual(
            self.client.get("/", query_string={**params, "page": "3"}).status_code, 404
        )
        all_categories = self.client.get(
            "/", query_string={"q": params["q"], "tag": "python"}
        )
        self.assertIn(b"18 articles match", all_categories.data)
        self.assertIn(b'href="/uncategorized"', all_categories.data)

    def test_search_handles_untrusted_and_invalid_input_without_changing_data(self):
        self.publish_first_article()
        before = self.database_rows("articles")
        for query in (
            "'; DROP TABLE articles; --",
            "<script>alert(1)</script>",
            '" onfocus="alert(1)',
            "x" * 200,
        ):
            with self.subTest(query=query):
                response = self.client.get("/", query_string={"q": query})
                self.assertEqual(response.status_code, 200)
                self.assertIn(
                    b"No articles match your search and filters", response.data
                )
                self.assertNotIn(b"<script>alert(1)</script>", response.data)
                self.assertNotIn(b' onfocus="alert(1)', response.data)
        for query, message in (
            ("x" * 201, b"at most 200 characters"),
            ("bad\x00query", b"unsupported character"),
        ):
            with (
                self.subTest(query=query),
                patch("app.articles.routes.paginate_articles") as paginate,
                patch(
                    "app.articles.routes.list_categories_with_article_counts"
                ) as counts,
            ):
                response = self.client.get(
                    "/", query_string={"q": query, "category": "tech"}
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn(message, response.data)
                self.assertIn(b'name="category" value="tech"', response.data)
                self.assertNotIn(b"article-card", response.data)
                paginate.assert_not_called()
                counts.assert_not_called()
        self.assertEqual(self.database_rows("articles"), before)

    def test_search_reflects_article_creation_edits_and_deletion(self):
        self.publish_first_article()
        self.assertIn(
            b'href="/first-article"',
            self.client.get("/", query_string={"q": "Article body"}).data,
        )
        self.assertEqual(
            self.post_form(
                "/first-article/edit", data=self.edit_data(body="Orchard harvest")
            ).status_code,
            302,
        )
        self.assertNotIn(
            b'href="/first-article"',
            self.client.get("/", query_string={"q": "Article body"}).data,
        )
        self.assertIn(
            b'href="/first-article"',
            self.client.get("/", query_string={"q": "Orchard harvest"}).data,
        )
        self.assertEqual(
            self.post_form(
                "/first-article/delete", data=self.deletion_data(version="2")
            ).status_code,
            302,
        )
        self.assertNotIn(
            b'href="/first-article"',
            self.client.get("/", query_string={"q": "Orchard harvest"}).data,
        )

    def test_search_index_is_valid_and_eligible_for_the_application_predicate(self):
        db.session.add(self.build_article(slug="indexed", body="Needle"))
        db.session.commit()
        index = db.session.execute(
            text(
                "SELECT am.amname, i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_am am ON am.oid = c.relam "
                "WHERE c.oid = 'ix_articles_search_vector'::regclass"
            )
        ).one()
        self.assertEqual(tuple(index), ("gin", True))
        statement = (
            db.session.query(Article.id)
            .filter(article_matches_search("needle"))
            .statement
        )
        sql = str(
            statement.compile(
                dialect=db.engine.dialect, compile_kwargs={"literal_binds": True}
            )
        )
        try:
            # Check index eligibility, not a performance claim on a tiny fixture.
            db.session.execute(text("SET LOCAL enable_seqscan = off"))
            plan = db.session.execute(text("EXPLAIN (FORMAT JSON) " + sql)).scalar_one()
            self.assertIn("ix_articles_search_vector", str(plan))
        finally:
            db.session.rollback()

    def test_search_index_migration_preserves_data_and_indexes_existing_articles(self):
        self.publish_first_article()
        db.session.remove()
        tables = ("articles", "users", "categories", "tags", "article_tags")
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="078253e87007")
            db.session.add(
                self.build_article(slug="before-index", body="Legacy orchard")
            )
            db.session.commit()
            before = {table: self.database_rows(table) for table in tables}
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)
            self.assertEqual(
                {table: self.database_rows(table) for table in tables}, before
            )
            self.assertIn(
                b'href="/before-index"',
                self.client.get("/", query_string={"q": "legacy orchard"}).data,
            )
            db.session.remove()
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="078253e87007")
            self.assertIsNone(
                db.session.execute(
                    text("SELECT to_regclass('ix_articles_search_vector')")
                ).scalar_one()
            )
            self.assertEqual(
                {table: self.database_rows(table) for table in tables}, before
            )
        finally:
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

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

    def test_article_version_migration_preserves_content_and_relationships(self):
        self.publish_first_article()
        db.session.remove()
        tables = ("users", "articles", "categories", "tags", "article_tags")
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="f68142d76006")
            before = {table: self.database_rows(table) for table in tables}
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)
            self.assertEqual(Article.query.one().version, 1)
            self.assertEqual(
                {
                    table: self.database_rows(table, exclude=("version",))
                    for table in tables
                },
                before,
            )
            saved = self.post_form("/first-article/edit", data=self.edit_data())
            self.assertEqual(saved.status_code, 302)
            self.assertEqual(Article.query.one().version, 2)
            edited = {
                table: self.database_rows(table, exclude=("version",))
                for table in tables
            }
            db.session.remove()
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="f68142d76006")
            self.assertEqual(
                {table: self.database_rows(table) for table in tables}, edited
            )
        finally:
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)
        self.assertEqual(Article.query.one().version, 1)
        self.assertEqual(self.client.get("/first-article").status_code, 200)

    def test_article_version_database_default_and_constraints(self):
        article_id = db.session.execute(
            text(
                "INSERT INTO articles (slug, title, description, text) "
                "VALUES ('versioned', 'Title', 'Description', 'Body') RETURNING id"
            )
        ).scalar_one()
        db.session.commit()
        self.assertEqual(Article.query.get(article_id).version, 1)
        for version in (None, 0, -1):
            for operation in ("insert", "update"):
                with self.subTest(version=version, operation=operation):
                    if operation == "insert":
                        statement = Article.__table__.insert().values(
                            slug="invalid-version",
                            title="Title",
                            description="Description",
                            text="Body",
                            version=version,
                        )
                    else:
                        statement = (
                            Article.__table__.update()
                            .where(Article.id == article_id)
                            .values(version=version)
                        )
                    with self.assertRaises(IntegrityError) as raised:
                        db.session.execute(statement)
                        db.session.commit()
                    db.session.rollback()
                    self.assertEqual(
                        raised.exception.orig.pgcode,
                        "23502" if version is None else "23514",
                    )
        self.assertEqual(Article.query.one().version, 1)

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
            table: self.database_rows(table, exclude=("version",)) for table in tables
        }
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="e57031c65005")
            upgrade(directory=MIGRATIONS_DIRECTORY)
            after = {
                table: self.database_rows(table, exclude=("version",))
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
                table: self.database_rows(table, exclude=("version",))
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
        before_articles = self.database_rows("articles", exclude=("version",))
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
                self.database_rows("articles", exclude=("version",)),
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
        before_articles = self.database_rows("articles", exclude=("version",))
        db.session.remove()
        try:
            downgrade(directory=MIGRATIONS_DIRECTORY, revision="c35e1fa43003")
            upgrade(directory=MIGRATIONS_DIRECTORY)
            self.assertEqual(
                db.session.execute(text("SELECT * FROM users ORDER BY id")).all(),
                before_users,
            )
            self.assertEqual(
                self.database_rows("articles", exclude=("version",)),
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
                self.database_rows("articles", exclude=("version",)),
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
