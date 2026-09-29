from flask import current_app, render_template

from app.comments.models import COMMENT_MAX_LENGTH
from app.comments.queries import paginate_comments


def render_article_detail(
    article, *, comments_page=1, comment_body="", comment_error=None, status=200
):
    return render_template(
        "articles/detail.html",
        article=article,
        comments=paginate_comments(
            article_id=article.id,
            page=comments_page,
            per_page=current_app.config["COMMENTS_PER_PAGE"],
        ),
        comment_body=comment_body.replace("\x00", "\ufffd"),
        comment_error=comment_error,
        comment_uncertain=status == 500,
        comment_max_length=COMMENT_MAX_LENGTH,
    ), status
