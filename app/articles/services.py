import re
from datetime import date

from sqlalchemy.exc import IntegrityError

from app.articles.models import (
    DESCRIPTION_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    Article,
)
from app.articles.queries import get_category_by_slug
from app.articles.uploads import remove_image, save_image
from app.errors import ValidationError
from app.extensions import db


def validate_article(*, title, description, body):
    title, description, body = (value.strip() for value in (title, description, body))
    if not all((title, description, body)):
        raise ValidationError("Please fill out all fields.")
    if len(title) > TITLE_MAX_LENGTH:
        raise ValidationError(f"Title must be at most {TITLE_MAX_LENGTH} characters.")
    if len(description) > DESCRIPTION_MAX_LENGTH:
        raise ValidationError(
            f"Description must be at most {DESCRIPTION_MAX_LENGTH} characters."
        )
    slug = re.sub(r"[^\w]+", "-", title.lower()).strip("-")
    if not slug or len(slug) > 80 or slug in {"new-post", "logout", "auth", "static"}:
        raise ValidationError("Please choose a different article title for its URL.")
    return {
        "title": title,
        "description": description,
        "body": body,
        "slug": slug,
    }


def create_article(
    *,
    author_id,
    title,
    description,
    category_slug,
    body,
    image,
    upload_directory,
    allowed_extensions,
):
    values = validate_article(title=title, description=description, body=body)
    category = get_category_by_slug(category_slug.strip())
    if category is None:
        raise ValidationError("Please choose a supported category.")
    if Article.query.filter_by(slug=values["slug"]).first():
        raise ValidationError(
            "An article with this URL already exists. Please choose a different title."
        )
    filename = save_image(
        image, directory=upload_directory, allowed_extensions=allowed_extensions
    )
    article = Article(
        **values,
        category=category,
        author_id=author_id,
        created_at=date.today(),
        image_filename=filename,
    )
    try:
        db.session.add(article)
        db.session.commit()
    except Exception as error:
        try:
            db.session.rollback()
        finally:
            remove_image(filename, directory=upload_directory)
        if isinstance(error, IntegrityError) and (
            getattr(getattr(error.orig, "diag", None), "constraint_name", None)
            == "articles_slug_key"
        ):
            raise ValidationError(
                "An article with this URL already exists. Please choose a different title."
            ) from error
        raise
    return article
