from app.extensions import CRUDMixin, db


class Article(db.Model, CRUDMixin):
    __tablename__ = "articles"

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(80), unique=True)
    body = db.Column("text", db.Text)
    description = db.Column(db.String(250))
    title = db.Column(db.String(55))
    category = db.Column(db.String(10))
    created_at = db.Column(db.Date)
    image_filename = db.Column("img_url", db.String(250))
    author_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    author = db.relationship("User", back_populates="articles")
