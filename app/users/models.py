from flask_login import UserMixin

from app.extensions import db


class User(db.Model, UserMixin):
    __tablename__ = "users"
    __table_args__ = (
        db.CheckConstraint(
            "username ~ '[^[:space:]]'", name="users_username_not_blank"
        ),
        db.CheckConstraint("email ~ '[^[:space:]]'", name="users_email_not_blank"),
        db.CheckConstraint(
            "password ~ '[^[:space:]]'", name="users_password_not_blank"
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(120), index=True, unique=True, nullable=False)
    password_hash = db.Column("password", db.String(250), nullable=False)
    articles = db.relationship("Article", back_populates="author")
