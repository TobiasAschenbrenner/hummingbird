from os import environ
from pathlib import Path

from dotenv import load_dotenv

def load_config(overrides=None):
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    config = {
        "SQLALCHEMY_DATABASE_URI": environ.get("DATABASE_URL"),
        "SECRET_KEY": environ.get("SECRET_KEY"),
        "SQLALCHEMY_TRACK_MODIFICATIONS": False,
        "BLOG_POSTS_PER_PAGE": 12,
        "ALLOWED_EXTENSIONS": {"png", "jpg", "jpeg", "gif"},
        "UPLOADS_PATH": Path(__file__).resolve().parent / "static/images/uploads",
    }
    config.update(overrides or {})

    database_url = config["SQLALCHEMY_DATABASE_URI"]
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is missing. Copy .env.example to .env "
            "and configure your database connection."
        )
    if database_url.startswith("postgres://"):
        config["SQLALCHEMY_DATABASE_URI"] = database_url.replace(
            "postgres://", "postgresql://", 1
        )

    if not config["SECRET_KEY"] or config["SECRET_KEY"] == "replace-with-a-generated-secret":
        raise RuntimeError(
            "SECRET_KEY is missing or still uses the example value. "
            "Set a generated secret in .env."
        )

    return config
