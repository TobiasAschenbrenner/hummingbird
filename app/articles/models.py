from app.extensions import db

TITLE_MAX_LENGTH = 55
DESCRIPTION_MAX_LENGTH = 250
CATEGORIES = ("design", "tech", "mobile")


class Category(db.Model):
    __tablename__ = "categories"

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(80), nullable=False, unique=True)
    name = db.Column(db.String(80), nullable=False)


class Article(db.Model):
    __tablename__ = "articles"

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(80), unique=True)
    body = db.Column("text", db.Text)
    description = db.Column(db.String(DESCRIPTION_MAX_LENGTH))
    title = db.Column(db.String(TITLE_MAX_LENGTH))
    category = db.Column(db.String(10))
    created_at = db.Column(db.Date)
    image_filename = db.Column("img_url", db.String(250))
    author_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    author = db.relationship("User", back_populates="articles")
