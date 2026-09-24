from flask import Flask
from flask_wtf.csrf import CSRFError

from app.config import load_config
from app.errors import handle_csrf_error
from app.extensions import csrf, db, login_manager, migrate
from app.request_limits import enforce_request_size, handle_request_size_error


def create_app(config_overrides=None):
    app = Flask(__name__)
    app.config.update(load_config(config_overrides))
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    app.before_request(enforce_request_size)
    csrf.init_app(app)
    app.register_error_handler(CSRFError, handle_csrf_error)
    app.register_error_handler(411, handle_request_size_error)
    app.register_error_handler(413, handle_request_size_error)

    from app.articles.routes import blueprint as articles_blueprint
    from app.commands.seed import seed_demo
    from app.users.routes import blueprint as users_blueprint

    app.register_blueprint(articles_blueprint)
    app.register_blueprint(users_blueprint)
    app.cli.add_command(seed_demo)
    return app
