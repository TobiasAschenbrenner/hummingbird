from os import environ
from os.path import dirname, join, realpath

from dotenv import load_dotenv

load_dotenv()

database_url = environ.get("DATABASE_URL")
if not database_url:
    raise RuntimeError(
        "DATABASE_URL is missing. Copy .env.example to .env "
        "and configure your database connection."
    )

SQLALCHEMY_DATABASE_URI = database_url.replace(
    "postgres://", "postgresql://", 1
)

SECRET_KEY = environ.get("SECRET_KEY")
if not SECRET_KEY or SECRET_KEY == "replace-with-a-generated-secret":
    raise RuntimeError(
        "SECRET_KEY is missing or still uses the example value. "
        "Set a generated secret in .env."
    )

BLOG_POSTS_PER_PAGE = 12

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif"}
UPLOADS_PATH = join(
    dirname(realpath(__file__)), "static/images/uploads/"
)