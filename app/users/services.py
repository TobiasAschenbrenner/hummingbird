from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from app.errors import ValidationError
from app.extensions import db
from app.users.models import EMAIL_WHITESPACE, User
from app.users.queries import get_user_by_email


def authenticate_user(*, email, password):
    email = email.strip(EMAIL_WHITESPACE)
    if not email or not password:
        raise ValidationError("Please fill out all fields.")
    user = get_user_by_email(email)
    if (
        not user
        or not user.password_hash
        or not check_password_hash(user.password_hash, password)
    ):
        raise ValidationError("Invalid email or password.")
    return user


def register_user(*, username, email, password, password_confirmation):
    username, email = username.strip(), email.strip(EMAIL_WHITESPACE)
    if not all((username, email, password, password_confirmation)):
        raise ValidationError("Please fill out all fields.")
    if len(username) > 80 or len(email) > 120:
        raise ValidationError(
            "Name must be at most 80 characters and email at most 120 characters."
        )
    if "@" not in email or any(character.isspace() for character in email):
        raise ValidationError("Please enter a valid email address.")
    if password != password_confirmation:
        raise ValidationError("The password confirmation must match the password.")
    if len(password) < 8:
        raise ValidationError("The password must be at least 8 characters long.")
    if get_user_by_email(email):
        raise ValidationError("The email address is already registered.")

    user = User(
        username=username, email=email, password_hash=generate_password_hash(password)
    )
    try:
        db.session.add(user)
        db.session.commit()
    except IntegrityError as error:
        db.session.rollback()
        if (
            getattr(getattr(error.orig, "diag", None), "constraint_name", None)
            == "ix_users_email_normalized"
        ):
            raise ValidationError("The email address is already registered.") from error
        raise
    except Exception:
        db.session.rollback()
        raise
    return user
