from sqlalchemy import and_, func
from sqlalchemy.orm import joinedload, selectinload

from app.articles.models import Article, Category, Tag
from app.extensions import db


def list_categories():
    return Category.query.order_by(Category.name, Category.id).all()


def get_category_by_slug(slug):
    return Category.query.filter_by(slug=slug).first()


def get_tag_by_slug(slug):
    return Tag.query.filter_by(slug=slug).first()


def list_categories_with_article_counts(*, tag_id=None):
    join_condition = Article.category_id == Category.id
    if tag_id is not None:
        join_condition = and_(join_condition, Article.tags.any(Tag.id == tag_id))
    return (
        db.session.query(Category, func.count(Article.id).label("article_count"))
        .outerjoin(Article, join_condition)
        .group_by(Category.id)
        .order_by(Category.name, Category.id)
        .all()
    )


def paginate_articles(*, page, per_page, category_id=None, tag_id=None):
    query = Article.query.options(
        joinedload(Article.author),
        joinedload(Article.category),
        selectinload(Article.tags),
    )
    if category_id is not None:
        query = query.filter(Article.category_id == category_id)
    if tag_id is not None:
        query = query.filter(Article.tags.any(Tag.id == tag_id))
    return query.order_by(Article.id.desc()).paginate(page=page, per_page=per_page)


def get_article_by_slug(slug):
    return (
        Article.query.options(
            joinedload(Article.author),
            joinedload(Article.category),
            selectinload(Article.tags),
        )
        .filter_by(slug=slug)
        .first()
    )


def get_owned_article(slug, *, author_id, for_update=False):
    query = Article.query.filter_by(slug=slug, author_id=author_id)
    if for_update:
        query = query.populate_existing().with_for_update()
    return query.first()


def is_image_referenced(filename):
    return db.session.query(
        Article.query.filter_by(image_filename=filename).exists()
    ).scalar()
