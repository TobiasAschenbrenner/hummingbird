from sqlalchemy import func
from sqlalchemy.orm import joinedload

from app.articles.models import Article, Category
from app.extensions import db


def list_categories():
    return Category.query.order_by(Category.name, Category.id).all()


def get_category_by_slug(slug):
    return Category.query.filter_by(slug=slug).first()


def list_categories_with_article_counts():
    return (
        db.session.query(Category, func.count(Article.id).label("article_count"))
        .outerjoin(Category.articles)
        .group_by(Category.id)
        .order_by(Category.name, Category.id)
        .all()
    )


def paginate_articles(*, page, per_page, category_id=None):
    query = Article.query.options(
        joinedload(Article.author), joinedload(Article.category)
    )
    if category_id is not None:
        query = query.filter(Article.category_id == category_id)
    return query.order_by(Article.id.desc()).paginate(page=page, per_page=per_page)


def get_article_by_slug(slug):
    return (
        Article.query.options(joinedload(Article.author), joinedload(Article.category))
        .filter_by(slug=slug)
        .first()
    )
