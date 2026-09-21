from sqlalchemy.orm import joinedload

from app.articles.models import Article, Category


def list_categories():
    return Category.query.order_by(Category.name, Category.id).all()


def get_category_by_slug(slug):
    return Category.query.filter_by(slug=slug).first()


def paginate_articles(*, page, per_page):
    return (
        Article.query.options(joinedload(Article.author), joinedload(Article.category))
        .order_by(Article.id.desc())
        .paginate(page=page, per_page=per_page)
    )


def get_article_by_slug(slug):
    return (
        Article.query.options(joinedload(Article.author), joinedload(Article.category))
        .filter_by(slug=slug)
        .first()
    )
