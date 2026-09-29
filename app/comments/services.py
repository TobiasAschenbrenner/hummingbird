from app.comments.models import COMMENT_MAX_LENGTH, Comment
from app.errors import ValidationError
from app.extensions import db


def create_comment(*, article_id, author_id, body):
    body = body.strip()
    if not body:
        raise ValidationError("Please enter a comment.")
    if len(body) > COMMENT_MAX_LENGTH:
        raise ValidationError(
            f"Comments must be at most {COMMENT_MAX_LENGTH} characters."
        )
    if "\x00" in body:
        raise ValidationError("Your comment contains an unsupported character.")
    comment = Comment(article_id=article_id, author_id=author_id, body=body)
    try:
        db.session.add(comment)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
