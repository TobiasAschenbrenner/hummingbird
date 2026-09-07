from werkzeug.security import generate_password_hash
from app.users.models import User


def register_user(form_data):
    # Create a new user record
    user = User(
        username=form_data.get("register_name"),
        email=form_data.get("register_email"),
        password_hash=generate_password_hash(form_data.get("register_password")),
    )
    return user.save()
