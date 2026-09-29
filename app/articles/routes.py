from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
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
    get_owned_article,
    get_tag_by_slug,
    list_categories,
    list_categories_with_article_counts,
    paginate_articles,
)
from app.articles.search import MAX_SEARCH_LENGTH, validate_search_query
from app.articles.services import create_article, delete_article, update_article
from app.articles.tags import MAX_ARTICLE_TAGS, MAX_TAG_INPUT_LENGTH
from app.articles.uploads import MAX_IMAGE_BYTES, MAX_IMAGE_FRAMES, MAX_IMAGE_PIXELS
from app.articles.views import render_article_detail
from app.errors import ConflictError, ValidationError
from app.extensions import db

blueprint = Blueprint("articles", __name__)


@blueprint.get("/")
def index():
    category_slug = request.args.get("category", "")
    selected_category = get_category_by_slug(category_slug) if category_slug else None
    if category_slug and selected_category is None:
        abort(404)
    tag_slug = request.args.get("tag", "")
    selected_tag = get_tag_by_slug(tag_slug) if tag_slug else None
    if tag_slug and selected_tag is None:
        abort(404)
    tag_id = selected_tag.id if selected_tag else None
    search_query = request.args.get("q", "").strip()
    error = None
    pagination = None
    category_counts = []
    try:
        validate_search_query(search_query)
    except ValidationError as validation_error:
        error = str(validation_error)
        search_query = search_query.replace("\x00", "\ufffd")
    if error is None:
        pagination = paginate_articles(
            page=request.args.get("page", 1, type=int),
            per_page=current_app.config["BLOG_POSTS_PER_PAGE"],
            category_id=selected_category.id if selected_category else None,
            tag_id=tag_id,
            search_query=search_query,
        )
        category_counts = list_categories_with_article_counts(
            tag_id=tag_id, search_query=search_query
        )
    return render_template(
        "articles/index.html",
        pagination=pagination,
        category_counts=category_counts,
        selected_category=selected_category,
        selected_tag=selected_tag,
        search_query=search_query,
        max_search_length=MAX_SEARCH_LENGTH,
        error=error,
    ), 400 if error else 200


def render_article_form(*, article=None, error=None, status=200):
    form = request.form
    if request.method == "GET" and article is not None:
        form = {
            "title": article.title,
            "description": article.description,
            "body": article.body,
            "category": article.category.slug if article.category else "",
            "tags": ", ".join(tag.name for tag in article.tags),
            "version": article.version,
            "article_id": article.id,
        }
    return render_template(
        "articles/form.html",
        article=article,
        error=error,
        edit_conflict=status == 409,
        form=form,
        categories=list_categories(),
        title_max_length=TITLE_MAX_LENGTH,
        description_max_length=DESCRIPTION_MAX_LENGTH,
        max_article_tags=MAX_ARTICLE_TAGS,
        max_tag_input_length=MAX_TAG_INPUT_LENGTH,
        allowed_extensions=sorted(current_app.config["ALLOWED_EXTENSIONS"]),
        max_image_mib=MAX_IMAGE_BYTES / (1024 * 1024),
        max_image_megapixels=MAX_IMAGE_PIXELS / 1_000_000,
        max_image_frames=MAX_IMAGE_FRAMES,
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


@blueprint.get("/<slug>/edit")
@login_required
def edit_article(slug):
    article = get_owned_article(slug, author_id=current_user.id)
    if article is None:
        abort(404)
    return render_article_form(article=article)


@blueprint.post("/<slug>/edit")
@login_required
def submit_article_edit(slug):
    article = get_owned_article(slug, author_id=current_user.id, for_update=True)
    if article is None:
        abort(404)
    try:
        update_article(
            article,
            expected_id=request.form.get("article_id", ""),
            expected_version=request.form.get("version", ""),
            title=request.form.get("title", ""),
            description=request.form.get("description", ""),
            category_slug=request.form.get("category", ""),
            body=request.form.get("body", ""),
            tag_names=request.form.get("tags", ""),
            image=request.files.get("image"),
            upload_directory=current_app.config["UPLOADS_PATH"],
            allowed_extensions=current_app.config["ALLOWED_EXTENSIONS"],
        )
    except ConflictError as error:
        return render_article_form(
            article=article,
            error=f"{error} Your changes have not been saved.",
            status=409,
        )
    except ValidationError as error:
        return render_article_form(article=article, error=str(error), status=400)
    except (SQLAlchemyError, OSError):
        db.session.rollback()
        current_app.logger.exception("Article update failed")
        return render_article_form(
            article=article,
            error="Unable to save your changes right now. Please try again.",
            status=500,
        )
    return redirect(url_for("articles.detail", slug=article.slug))


def render_deletion_form(*, article, error=None, status=200):
    form = (
        request.form
        if request.method == "POST"
        else {
            "article_id": article.id,
            "version": article.version,
        }
    )
    return render_template(
        "articles/delete.html",
        article=article,
        form=form,
        error=error,
        deletion_uncertain=status == 500,
    ), status


@blueprint.get("/<slug>/delete")
@login_required
def confirm_article_deletion(slug):
    article = get_owned_article(slug, author_id=current_user.id)
    if article is None:
        abort(404)
    return render_deletion_form(article=article)


@blueprint.post("/<slug>/delete")
@login_required
def submit_article_deletion(slug):
    article = get_owned_article(slug, author_id=current_user.id, for_update=True)
    if article is None:
        abort(404)
    # Keep the error page usable even if a committed delete loses its acknowledgement.
    details = {"id": article.id, "slug": article.slug, "title": article.title}
    try:
        delete_article(
            article,
            expected_id=request.form.get("article_id", ""),
            expected_version=request.form.get("version", ""),
            confirmed=request.form.get("confirm_delete") == "yes",
            upload_directory=current_app.config["UPLOADS_PATH"],
        )
    except ConflictError as error:
        return render_deletion_form(
            article=details, error=f"{error} Nothing was deleted.", status=409
        )
    except ValidationError as error:
        return render_deletion_form(article=details, error=str(error), status=400)
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception("Article deletion failed")
        return render_deletion_form(
            article=details,
            error="We could not confirm whether the article was deleted. "
            "Check the article list before trying again.",
            status=500,
        )
    flash("Article deleted.", "success")
    return redirect(url_for("articles.index"))


@blueprint.get("/<slug>")
def detail(slug):
    article = get_article_by_slug(slug)
    if article is None:
        abort(404)
    return render_article_detail(
        article, comments_page=request.args.get("comments_page", 1, type=int)
    )
