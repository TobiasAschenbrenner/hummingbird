import base64
import io
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from flask_migrate import downgrade, upgrade
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from app import create_app
from app.articles.models import Article, Category
from app.extensions import db
from app.users.models import User

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
            text("TRUNCATE articles, users, categories RESTART IDENTITY CASCADE")
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

    def login(self):
        return self.client.post(
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

    def test_homepage_and_missing_article(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/missing-article").status_code, 404)

    def test_registration_stores_password_hash(self):
        response = self.client.post(
            "/auth/register",
            data={
                "register_name": "Author",
                "register_email": "author@example.test",
                "register_password": "password123",
                "register_password_confirmation": "password123",
            },
        )
        self.assertEqual(response.status_code, 302)
        user = User.query.one()
        self.assertNotEqual(user.password_hash, "password123")
        self.assertTrue(check_password_hash(user.password_hash, "password123"))

    def test_login_and_logout(self):
        self.create_user()
        response = self.client.post(
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
        self.client.get("/logout")
        self.assertEqual(self.client.get("/new-post").status_code, 401)

    def test_anonymous_article_creation_is_rejected(self):
        self.assertEqual(self.client.get("/new-post").status_code, 401)
        self.assertEqual(
            self.client.post("/new-post", data=self.article_data()).status_code, 401
        )
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_article_creation_and_detail(self):
        user = self.create_user()
        self.login()
        response = self.client.post(
            "/new-post", data=self.article_data(), follow_redirects=True
        )
        self.assertEqual(response.status_code, 200)
        article = Article.query.one()
        self.assertEqual(article.author_id, user.id)
        self.assertTrue((Path(self.uploads.name) / article.image_filename).exists())
        detail = self.client.get(f"/{article.slug}")
        self.assertIn(b"Article body", detail.data)

    def test_missing_title_does_not_create_an_article(self):
        self.create_user()
        self.login()
        response = self.client.post("/new-post", data=self.article_data(title=""))
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
            {"body": " "},
            {"title": "new-post"},
            {"title": "!!!"},
        ]:
            with self.subTest(overrides=overrides):
                response = self.client.post(
                    "/new-post", data=self.article_data(**overrides)
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(Article.query.count(), 0)
                self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_creation_redirects_and_duplicate_slug_is_handled(self):
        self.create_user()
        self.login()
        response = self.client.post("/new-post", data=self.article_data())
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.location, "/")
        response = self.client.post("/new-post", data=self.article_data())
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"already exists", response.data)
        self.assertNotIn(b"INSERT INTO", response.data)
        self.assertEqual(Article.query.count(), 1)

    def test_missing_image_has_a_useful_error(self):
        self.create_user()
        self.login()
        data = self.article_data()
        del data["image"]
        response = self.client.post("/new-post", data=data)
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"Please choose an image", response.data)
        self.assertEqual(Article.query.count(), 0)

    def test_rejected_upload_does_not_create_an_article(self):
        self.create_user()
        self.login()
        response = self.client.post(
            "/new-post", data=self.article_data(image=(io.BytesIO(b"text"), "bad.html"))
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"Unsupported image extension", response.data)
        self.assertEqual(Article.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_database_failure_rolls_back_and_removes_new_upload(self):
        self.create_user()
        self.login()
        self.client.post("/new-post", data=self.article_data())
        existing_files = set(Path(self.uploads.name).iterdir())

        def force_duplicate_slug(mapper, connection, article):
            article.slug = "first-article"

        event.listen(Article, "before_insert", force_duplicate_slug)
        try:
            response = self.client.post(
                "/new-post", data=self.article_data(title="Concurrent article")
            )
        finally:
            event.remove(Article, "before_insert", force_duplicate_slug)
        self.assertEqual(response.status_code, 400)
        self.assertIn(b"already exists", response.data)
        self.assertEqual(Article.query.count(), 1)
        self.assertEqual(set(Path(self.uploads.name).iterdir()), existing_files)
        response = self.client.post(
            "/new-post", data=self.article_data(title="After rollback")
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Article.query.count(), 2)

    def test_concurrent_registration_duplicate_is_handled(self):
        self.create_user()

        def force_duplicate_email(mapper, connection, user):
            user.email = "author@example.test"

        event.listen(User, "before_insert", force_duplicate_email)
        try:
            response = self.client.post(
                "/auth/register",
                data={
                    "register_name": "Another Author",
                    "register_email": "new@example.test",
                    "register_password": "password123",
                    "register_password_confirmation": "password123",
                },
                follow_redirects=True,
            )
        finally:
            event.remove(User, "before_insert", force_duplicate_email)
        self.assertIn(b"already registered", response.data)
        self.assertEqual(User.query.count(), 1)

    def test_author_loading_does_not_add_per_article_queries(self):
        from app.articles.queries import paginate_articles

        users = [
            self.create_user(email=f"author{number}@example.test")
            for number in range(3)
        ]
        db.session.add_all(
            [
                Article(
                    title=f"Article {number}",
                    slug=f"article-{number}",
                    author_id=user.id,
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
        finally:
            event.remove(db.engine, "before_cursor_execute", record_statement)
        self.assertLessEqual(len(statements), 2)

    def test_article_order_and_pagination(self):
        user = self.create_user()
        db.session.add_all(
            [
                Article(
                    title=f"Article {number}",
                    slug=f"article-{number}",
                    body="Body",
                    description="Description",
                    category="tech",
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

    def test_models_match_committed_migration(self):
        with db.engine.connect() as connection:
            context = MigrationContext.configure(
                connection, opts={"compare_type": True, "compare_server_default": True}
            )
            self.assertEqual(compare_metadata(context, db.metadata), [])

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
                    "INSERT INTO articles (slug, title, text, category, img_url) "
                    "VALUES ('old-story', 'Old story', 'Original body', 'tech', 'old.webp')"
                )
            )
            db.session.commit()
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)
            self.assertEqual(
                {category.slug for category in Category.query.all()},
                {"design", "tech", "mobile"},
            )
            article = Article.query.filter_by(slug="old-story").one()
            self.assertEqual(article.body, "Original body")
            self.assertEqual(article.image_filename, "old.webp")
        finally:
            db.session.rollback()
            db.session.remove()
            upgrade(directory=MIGRATIONS_DIRECTORY)

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
        for article in Article.query.all():
            self.assertEqual(self.client.get(f"/{article.slug}").status_code, 200)
        result = runner.invoke(args=["seed-demo", "--count", "3"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Created 0 articles", result.output)
        self.assertEqual(Article.query.count(), 3)
        self.assertEqual(
            User.query.filter_by(email="demo@hummingbird.example").one().password_hash,
            original_demo_hash,
        )
        self.assertEqual(
            User.query.filter_by(email="author@example.test").one().password_hash,
            existing_hash,
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
                "INSERT INTO articles (title, slug, text, img_url, author_id) VALUES (:title, :slug, :body, :image, :author_id)"
            ),
            {
                "title": "Existing article",
                "slug": "original-url",
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
            ("register_password_confirmation", "different"),
            ("register_name", "x" * 81),
        ]:
            with self.subTest(field=field):
                response = self.client.post(
                    "/auth/register", data={**data, field: value}, follow_redirects=True
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(User.query.count(), 0)
        self.create_user()
        response = self.client.post("/auth/register", data=data, follow_redirects=True)
        self.assertIn(b"already registered", response.data)
        self.assertEqual(User.query.count(), 1)

    def test_authentication_errors_return_to_article(self):
        user = self.create_user()
        db.session.add(
            Article(title="Story", slug="story", body="Body", author_id=user.id)
        )
        db.session.commit()
        response = self.client.post(
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
                response = self.client.post("/auth/login", data={"return_to": target})
                self.assertEqual(response.location, "/")


if __name__ == "__main__":
    unittest.main()
