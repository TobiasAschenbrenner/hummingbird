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

from app.articles.models import Article
from app.articles.views import render_article_detail
from app.comments.queries import get_owned_comment_details
from app.comments.services import create_comment, delete_comment
from app.errors import ValidationError
from app.extensions import db

blueprint = Blueprint("comments", __name__)


@blueprint.post("/articles/<int:article_id>/comments")
@login_required
def submit_comment(article_id):
    article = Article.query.get_or_404(article_id)
    slug = article.slug
    body = request.form.get("body", "")
    try:
        create_comment(article_id=article.id, author_id=current_user.id, body=body)
    except ValidationError as error:
        return render_article_detail(
            article, comment_body=body, comment_error=str(error), status=400
        )
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception("Comment creation failed")
        article = Article.query.get_or_404(article_id)
        return render_article_detail(
            article,
            comment_body=body,
            comment_error="We could not confirm whether your comment was saved. "
            "Check the comments before trying again.",
            status=500,
        )
    flash("Comment posted.", "success")
    return redirect(url_for("articles.detail", slug=slug, _anchor="comments"), code=303)


def render_comment_deletion(comment, *, error=None, status=200):
    return render_template(
        "comments/delete.html",
        comment=comment,
        error=error,
        deletion_uncertain=status == 500,
    ), status


@blueprint.get("/comments/<int:comment_id>/delete")
@login_required
def confirm_comment_deletion(comment_id):
    comment = get_owned_comment_details(comment_id, author_id=current_user.id)
    if comment is None:
        abort(404)
    return render_comment_deletion(comment)


@blueprint.post("/comments/<int:comment_id>/delete")
@login_required
def submit_comment_deletion(comment_id):
    comment = get_owned_comment_details(comment_id, author_id=current_user.id)
    if comment is None:
        abort(404)
    try:
        deleted = delete_comment(
            comment_id=comment.id,
            author_id=current_user.id,
            confirmed=request.form.get("confirm_delete") == "yes",
        )
    except ValidationError as error:
        return render_comment_deletion(comment, error=str(error), status=400)
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception("Comment deletion failed")
        return render_comment_deletion(
            comment,
            error="We could not confirm whether the comment was deleted. "
            "Check the comments before trying again.",
            status=500,
        )
    if not deleted:
        abort(404)
    flash("Comment deleted.", "success")
    return redirect(
        url_for("articles.detail", slug=comment.article_slug, _anchor="comments"),
        code=303,
    )
