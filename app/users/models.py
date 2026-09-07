from flask_login import UserMixin

from app.extensions import db


class User(db.Model, UserMixin):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80))
    email = db.Column(db.String(120), index=True, unique=True)
    password_hash = db.Column("password", db.String(250))
    articles = db.relationship("Article", back_populates="author")
