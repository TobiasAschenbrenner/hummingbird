from sqlalchemy.orm import joinedload

from app.comments.models import Comment


def paginate_comments(*, article_id, page, per_page):
    return (
        Comment.query.options(joinedload(Comment.author))
        .filter_by(article_id=article_id)
        .order_by(Comment.id.desc())
        .paginate(page=page, per_page=per_page)
    )
