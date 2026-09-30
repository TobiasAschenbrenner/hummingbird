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


def delete_comment(*, comment_id, author_id, confirmed):
    if not confirmed:
        raise ValidationError(
            "Please confirm that you want to permanently delete this comment."
        )
    try:
        deleted = Comment.query.filter_by(id=comment_id, author_id=author_id).delete(
            synchronize_session=False
        )
        if not deleted:
            db.session.rollback()
            return False
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return True
