from app.extensions import db

TITLE_MAX_LENGTH = 55
DESCRIPTION_MAX_LENGTH = 250
TAG_NAME_MAX_LENGTH = 40
TAG_SLUG_MAX_LENGTH = 80

article_tags = db.Table(
    "article_tags",
    db.Column(
        "article_id",
        db.Integer,
        db.ForeignKey("articles.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    db.Column(
        "tag_id",
        db.Integer,
        db.ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    db.Index("ix_article_tags_tag_id", "tag_id"),
)


class Tag(db.Model):
    __tablename__ = "tags"
    __table_args__ = (
        db.CheckConstraint("btrim(name) <> ''", name="tags_name_not_blank"),
        db.CheckConstraint("btrim(slug) <> ''", name="tags_slug_not_blank"),
    )

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(TAG_SLUG_MAX_LENGTH), nullable=False, unique=True)
    name = db.Column(db.String(TAG_NAME_MAX_LENGTH), nullable=False)
    articles = db.relationship(
        "Article", secondary=article_tags, back_populates="tags", passive_deletes=True
    )


class Category(db.Model):
    __tablename__ = "categories"

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(80), nullable=False, unique=True)
    name = db.Column(db.String(80), nullable=False)
    articles = db.relationship(
        "Article", back_populates="category", passive_deletes="all"
    )


class Article(db.Model):
    __tablename__ = "articles"
    __table_args__ = (
        db.CheckConstraint("title ~ '[^[:space:]]'", name="articles_title_not_blank"),
        db.CheckConstraint("slug ~ '[^[:space:]]'", name="articles_slug_not_blank"),
        db.CheckConstraint(
            "description ~ '[^[:space:]]'", name="articles_description_not_blank"
        ),
        db.CheckConstraint("text ~ '[^[:space:]]'", name="articles_text_not_blank"),
    )

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(80), unique=True, nullable=False)
    body = db.Column("text", db.Text, nullable=False)
    description = db.Column(db.String(DESCRIPTION_MAX_LENGTH), nullable=False)
    title = db.Column(db.String(TITLE_MAX_LENGTH), nullable=False)
    category_id = db.Column(
        db.Integer, db.ForeignKey("categories.id", ondelete="RESTRICT"), index=True
    )
    category = db.relationship("Category", back_populates="articles")
    created_at = db.Column(db.Date)
    image_filename = db.Column("img_url", db.String(250))
    author_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    author = db.relationship("User", back_populates="articles")
    tags = db.relationship(
        "Tag",
        secondary=article_tags,
        back_populates="articles",
        order_by="Tag.name, Tag.id",
        passive_deletes=True,
    )
