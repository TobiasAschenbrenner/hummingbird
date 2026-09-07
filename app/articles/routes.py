from flask import (
    Blueprint,
    abort,
    current_app,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import current_user, login_required
from sqlalchemy.exc import SQLAlchemyError

from app.articles.models import CATEGORIES, DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH
from app.articles.queries import get_article_by_slug, paginate_articles
from app.articles.services import create_article
from app.errors import ValidationError
from app.extensions import db

blueprint = Blueprint("articles", __name__)


@blueprint.get("/")
def index():
    pagination = paginate_articles(
        page=request.args.get("page", 1, type=int),
        per_page=current_app.config["BLOG_POSTS_PER_PAGE"],
    )
    return render_template(
        "articles/index.html", pagination=pagination, categories=CATEGORIES
    )


def render_article_form(*, error=None, status=200):
    return render_template(
        "articles/create.html",
        error=error,
        form=request.form,
        categories=CATEGORIES,
        title_max_length=TITLE_MAX_LENGTH,
        description_max_length=DESCRIPTION_MAX_LENGTH,
        allowed_extensions=sorted(current_app.config["ALLOWED_EXTENSIONS"]),
    ), status


@blueprint.get("/new-post")
@login_required
def new_article():
    return render_article_form()


@blueprint.post("/new-post")
@login_required
def submit_article():
    try:
        create_article(
            author_id=current_user.id,
            title=request.form.get("title", ""),
            description=request.form.get("description", ""),
            category=request.form.get("category", ""),
            body=request.form.get("body", ""),
            image=request.files.get("image"),
            upload_directory=current_app.config["UPLOADS_PATH"],
            allowed_extensions=current_app.config["ALLOWED_EXTENSIONS"],
        )
    except ValidationError as error:
        return render_article_form(error=str(error), status=400)
    except (SQLAlchemyError, OSError):
        db.session.rollback()
        current_app.logger.exception("Article creation failed")
        return render_article_form(
            error="Unable to save your article right now. Please try again.", status=500
        )
    return redirect(url_for("articles.index"))


@blueprint.get("/<slug>")
def detail(slug):
    article = get_article_by_slug(slug)
    if article is None:
        abort(404)
    return render_template("articles/detail.html", article=article)
