from sqlalchemy.orm import joinedload

from app.articles.models import Article


def paginate_articles(*, page, per_page):
    return (
        Article.query.options(joinedload(Article.author))
        .order_by(Article.id.desc())
        .paginate(page=page, per_page=per_page)
    )


def get_article_by_slug(slug):
    return (
        Article.query.options(joinedload(Article.author)).filter_by(slug=slug).first()
    )
