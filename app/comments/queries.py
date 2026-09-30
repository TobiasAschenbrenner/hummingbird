from sqlalchemy.orm import joinedload

from app.articles.models import Article
from app.comments.models import Comment
from app.extensions import db


def paginate_comments(*, article_id, page, per_page):
    return (
        Comment.query.options(joinedload(Comment.author))
        .filter_by(article_id=article_id)
        .order_by(Comment.id.desc())
        .paginate(page=page, per_page=per_page)
    )


def get_owned_comment_details(comment_id, *, author_id):
    """Read display values that remain usable after deletion or rollback."""
    return (
        db.session.query(
            Comment.id,
            Comment.body,
            Article.title.label("article_title"),
            Article.slug.label("article_slug"),
        )
        .join(Article, Comment.article_id == Article.id)
        .filter(Comment.id == comment_id, Comment.author_id == author_id)
        .first()
    )
