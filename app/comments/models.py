from app.extensions import db

COMMENT_MAX_LENGTH = 2000


class Comment(db.Model):
    __tablename__ = "comments"
    __table_args__ = (
        db.CheckConstraint("body ~ '[^[:space:]]'", name="comments_body_not_blank"),
        db.CheckConstraint(
            f"char_length(body) <= {COMMENT_MAX_LENGTH}",
            name="comments_body_length",
        ),
        db.Index("ix_comments_article_id_id", "article_id", "id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    body = db.Column(db.Text, nullable=False)
    article_id = db.Column(
        db.Integer,
        db.ForeignKey("articles.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True), nullable=False, server_default=db.func.now()
    )
    article = db.relationship("Article")
    author = db.relationship("User")
