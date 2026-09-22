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

from app.articles.models import DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH
from app.articles.queries import (
    get_article_by_slug,
    get_category_by_slug,
    list_categories,
    list_categories_with_article_counts,
    paginate_articles,
)
from app.articles.services import create_article
from app.articles.tags import MAX_ARTICLE_TAGS, MAX_TAG_INPUT_LENGTH
from app.errors import ValidationError
from app.extensions import db

blueprint = Blueprint("articles", __name__)


@blueprint.get("/")
def index():
    category_slug = request.args.get("category", "")
    selected_category = get_category_by_slug(category_slug) if category_slug else None
    if category_slug and selected_category is None:
        abort(404)
    pagination = paginate_articles(
        page=request.args.get("page", 1, type=int),
        per_page=current_app.config["BLOG_POSTS_PER_PAGE"],
        category_id=selected_category.id if selected_category else None,
    )
    return render_template(
        "articles/index.html",
        pagination=pagination,
        category_counts=list_categories_with_article_counts(),
        selected_category=selected_category,
    )


def render_article_form(*, error=None, status=200):
    return render_template(
        "articles/create.html",
        error=error,
        form=request.form,
        categories=list_categories(),
        title_max_length=TITLE_MAX_LENGTH,
        description_max_length=DESCRIPTION_MAX_LENGTH,
        max_article_tags=MAX_ARTICLE_TAGS,
        max_tag_input_length=MAX_TAG_INPUT_LENGTH,
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
            category_slug=request.form.get("category", ""),
            body=request.form.get("body", ""),
            tag_names=request.form.get("tags", ""),
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
