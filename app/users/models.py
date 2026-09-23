from flask_login import UserMixin

from app.extensions import db

EMAIL_WHITESPACE = " \t\n\r\f\v"


def email_lookup_key(value):
    """Use the same PostgreSQL expression for email lookups and uniqueness."""
    return db.func.lower(db.func.btrim(value, EMAIL_WHITESPACE))


class User(db.Model, UserMixin):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(120), nullable=False)
    password_hash = db.Column("password", db.String(250), nullable=False)
    articles = db.relationship("Article", back_populates="author")

    __table_args__ = (
        db.CheckConstraint(
            "username ~ '[^[:space:]]'", name="users_username_not_blank"
        ),
        db.CheckConstraint("email ~ '[^[:space:]]'", name="users_email_not_blank"),
        db.CheckConstraint(
            "password ~ '[^[:space:]]'", name="users_password_not_blank"
        ),
        db.Index("ix_users_email_normalized", email_lookup_key(email), unique=True),
    )
