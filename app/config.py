from dotenv import load_dotenv
from os import environ
from os.path import join, dirname, realpath

load_dotenv()
SQLALCHEMY_DATABASE_URI = environ.get('DATABASE_URL').replace('postgres://', 'postgresql://', 1)

BLOG_POSTS_PER_PAGE = 12

SECRET_KEY = environ.get('SECRET_KEY')

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
UPLOADS_PATH = join(dirname(realpath(__file__)), 'static/images/uploads/')