from urllib.parse import urlsplit

from flask import Blueprint, current_app, flash, redirect, request, url_for
from flask_login import login_user, logout_user
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException

from app.errors import ValidationError
from app.extensions import db
from app.users.services import authenticate_user, register_user

blueprint = Blueprint("users", __name__)


def authentication_return_url():
    """Only return to a known public article page, never an external URL."""
    target = request.form.get("return_to", "/")
    try:
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc or "\\" in target:
            return url_for("articles.index")
        endpoint, values = current_app.url_map.bind("").match(parsed.path, method="GET")
        if endpoint in {"articles.index", "articles.detail"}:
            return url_for(endpoint, **values)
    except (ValueError, HTTPException):
        pass
    return url_for("articles.index")


@blueprint.post("/auth/login")
def login():
    try:
        user = authenticate_user(
            email=request.form.get("login_email", ""),
            password=request.form.get("login_password", ""),
        )
    except ValidationError as error:
        flash(str(error), "error")
        return redirect(authentication_return_url())
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception("Login failed")
        flash("Unable to log in right now. Please try again.", "error")
        return redirect(authentication_return_url())
    login_user(user)
    return redirect(url_for("articles.index"))


@blueprint.post("/auth/register")
def register():
    try:
        user = register_user(
            username=request.form.get("register_name", ""),
            email=request.form.get("register_email", ""),
            password=request.form.get("register_password", ""),
            password_confirmation=request.form.get(
                "register_password_confirmation", ""
            ),
        )
    except ValidationError as error:
        flash(str(error), "error")
        return redirect(authentication_return_url())
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception("Registration failed")
        flash("Unable to register right now. Please try again.", "error")
        return redirect(authentication_return_url())
    login_user(user)
    return redirect(url_for("articles.index"))


@blueprint.get("/logout")
def logout():
    logout_user()
    return redirect(url_for("articles.index"))
