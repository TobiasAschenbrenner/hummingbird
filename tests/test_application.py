import base64
import io
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from flask_migrate import upgrade
from sqlalchemy import text
from sqlalchemy.engine import make_url
from werkzeug.security import check_password_hash, generate_password_hash

from app.app import create_app
from app.extensions.database import db
from app.new_posts.models import Articles
from app.users.models import Users


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/x8AAwMCAO+a5WQAAAAASUVORK5CYII="
)


class ApplicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database_url = os.environ.get("TEST_DATABASE_URL")
        if not database_url:
            raise unittest.SkipTest("Set TEST_DATABASE_URL to a dedicated PostgreSQL test database.")
        url = make_url(database_url)
        if url.get_backend_name() != "postgresql" or not (url.database or "").endswith("_test"):
            raise RuntimeError("Tests require a PostgreSQL database whose name ends in _test.")
        cls.uploads = tempfile.TemporaryDirectory(prefix="hummingbird-test-uploads-")
        cls.addClassCleanup(cls.uploads.cleanup)
        cls.app = create_app({
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": database_url,
            "SECRET_KEY": "test-secret-only",
            "UPLOADS_PATH": Path(cls.uploads.name),
        })
        with cls.app.app_context():
            upgrade(directory=str(Path(__file__).resolve().parents[1] / "migrations"))

    def setUp(self):
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        self.addCleanup(db.session.remove)
        db.session.execute(text("TRUNCATE articles, users RESTART IDENTITY CASCADE"))
        db.session.commit()
        for image in Path(self.uploads.name).iterdir():
            if image.is_file():
                image.unlink()
        self.client = self.app.test_client()

    def create_user(self, email="author@example.test"):
        user = Users(username="Author", email=email, password=generate_password_hash("password123"))
        db.session.add(user)
        db.session.commit()
        return user

    def login(self):
        return self.client.post("/", data={
            "login_email": "author@example.test", "login_password": "password123",
        })

    def article_data(self, **overrides):
        data = {
            "title": "First article", "description": "A description", "category": "tech",
            "text": "Article body", "file": (io.BytesIO(PNG), "cover.png"),
        }
        data.update(overrides)
        return data

    def test_homepage_and_missing_article(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/missing-article").status_code, 404)

    def test_registration_stores_password_hash(self):
        response = self.client.post("/", data={
            "register_name": "Author", "register_email": "author@example.test",
            "register_password": "password123", "register_confirmPassword": "password123",
        })
        self.assertEqual(response.status_code, 302)
        user = Users.query.one()
        self.assertNotEqual(user.password, "password123")
        self.assertTrue(check_password_hash(user.password, "password123"))

    def test_login_and_logout(self):
        self.create_user()
        response = self.client.post("/", data={
            "login_email": "author@example.test", "login_password": "incorrect",
        })
        self.assertIn(b"Invalid email or password", response.data)
        self.assertEqual(self.login().status_code, 302)
        self.assertEqual(self.client.get("/new-post").status_code, 200)
        self.client.get("/logout")
        self.assertEqual(self.client.get("/new-post").status_code, 401)

    def test_anonymous_article_creation_is_rejected(self):
        self.assertEqual(self.client.get("/new-post").status_code, 401)
        self.assertEqual(self.client.post("/new-post", data=self.article_data()).status_code, 401)
        self.assertEqual(Articles.query.count(), 0)
        self.assertEqual(list(Path(self.uploads.name).iterdir()), [])

    def test_article_creation_and_detail(self):
        user = self.create_user()
        self.login()
        response = self.client.post("/new-post", data=self.article_data(), follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        article = Articles.query.one()
        self.assertEqual(article.author_id, user.id)
        self.assertTrue((Path(self.uploads.name) / article.img_url).exists())
        detail = self.client.get(f"/{article.slug}")
        self.assertIn(b"Article body", detail.data)

    def test_missing_title_does_not_create_an_article(self):
        self.create_user()
        self.login()
        response = self.client.post("/new-post", data=self.article_data(title=""))
        self.assertIn(b"Please fill out all fields", response.data)
        self.assertEqual(Articles.query.count(), 0)

    def test_article_order_and_pagination(self):
        user = self.create_user()
        db.session.add_all([
            Articles(title=f"Article {number}", slug=f"article-{number}", text="Body",
                     description="Description", category="tech", created_at=date.today(),
                     img_url="cover.png", author_id=user.id)
            for number in range(13)
        ])
        db.session.commit()
        first_page = self.client.get("/").data
        self.assertIn(b"/article-12", first_page)
        self.assertNotIn(b'"/article-0"', first_page)
        self.assertIn(b'"/article-0"', self.client.get("/?page=2").data)

    def test_models_match_committed_migration(self):
        with db.engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            self.assertEqual(compare_metadata(context, db.metadata), [])


if __name__ == "__main__":
    unittest.main()
