from flask import Blueprint, current_app, flash, redirect, request, url_for
from flask_login import current_user, login_required
from sqlalchemy.exc import SQLAlchemyError

from app.articles.models import Article
from app.articles.views import render_article_detail
from app.comments.services import create_comment
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
