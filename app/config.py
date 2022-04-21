from dotenv import load_dotenv
from os import environ

load_dotenv()
SQLALCHEMY_DATABASE_URI = environ.get('DATABASE_URL').replace('postgres://', 'postgresql://', 1)

BLOG_POSTS_PER_PAGE = 12

SECRET_KEY = environ.get('SECRET_KEY')

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
UPLOAD_FOLDER = 'app/static/images/uploads'