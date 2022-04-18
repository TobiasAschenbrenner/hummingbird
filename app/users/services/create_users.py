from werkzeug.security import generate_password_hash
from app.users.models import Users

def create_users(form_data):
    # Create a new user record
    user = Users(
        username=form_data.get('register_name'),
        email=form_data.get('register_email'),
        password=generate_password_hash(form_data.get('register_password'))
    )
    return user.save()