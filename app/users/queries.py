from app.users.models import User, email_lookup_key


def get_user_by_email(email):
    return User.query.filter(
        email_lookup_key(User.email) == email_lookup_key(email)
    ).first()
