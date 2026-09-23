from flask_login import LoginManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect

csrf = CSRFProtect()
db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()


@login_manager.user_loader
def load_user(user_id):
    from app.users.models import User

    try:
        return db.session.get(User, int(user_id))
    except (TypeError, ValueError):
        return None
