from flask import Flask

from app.config import load_config
from app.extensions import db, login_manager, migrate


def create_app(config_overrides=None):
    app = Flask(__name__)
    app.config.update(load_config(config_overrides))
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)

    from app.articles.routes import blueprint as articles_blueprint
    from app.commands.seed import seed_demo
    from app.users.routes import blueprint as users_blueprint

    app.register_blueprint(articles_blueprint)
    app.register_blueprint(users_blueprint)
    app.cli.add_command(seed_demo)
    return app
