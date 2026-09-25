import logging
import re
from datetime import date

from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.articles.models import (
    DESCRIPTION_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    Article,
)
from app.articles.queries import get_category_by_slug, is_image_referenced
from app.articles.tags import get_or_create_tags, parse_tag_names
from app.articles.uploads import remove_image, save_image
from app.errors import ValidationError
from app.extensions import db

logger = logging.getLogger(__name__)


def validate_article_content(*, title, description, body):
    title, description, body = (value.strip() for value in (title, description, body))
    if not all((title, description, body)):
        raise ValidationError("Please fill out all fields.")
    if len(title) > TITLE_MAX_LENGTH:
        raise ValidationError(f"Title must be at most {TITLE_MAX_LENGTH} characters.")
    if len(description) > DESCRIPTION_MAX_LENGTH:
        raise ValidationError(
            f"Description must be at most {DESCRIPTION_MAX_LENGTH} characters."
        )
    return {
        "title": title,
        "description": description,
        "body": body,
    }


def generate_article_slug(title):
    slug = re.sub(r"[^\w]+", "-", title.lower()).strip("-")
    if not slug or len(slug) > 80 or slug in {"new-post", "logout", "auth", "static"}:
        raise ValidationError("Please choose a different article title for its URL.")
    return slug


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
    tag_names="",
):
    values = validate_article_content(title=title, description=description, body=body)
    values["slug"] = generate_article_slug(values["title"])
    parsed_tags = parse_tag_names(tag_names)
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
    try:
        tags = get_or_create_tags(parsed_tags)
        article = Article(
            **values,
            category=category,
            author_id=author_id,
            created_at=date.today(),
            image_filename=filename,
            tags=tags,
        )
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


def update_article(
    article,
    *,
    title,
    description,
    category_slug,
    body,
    tag_names,
    image,
    upload_directory,
    allowed_extensions,
):
    """Update an article already authorized and locked by the caller."""
    previous_filename = article.image_filename
    new_filename = None
    try:
        values = validate_article_content(
            title=title, description=description, body=body
        )
        parsed_tags = parse_tag_names(tag_names)
        category = get_category_by_slug(category_slug.strip())
        if category is None:
            raise ValidationError("Please choose a supported category.")
        if image is not None and image.filename:
            new_filename = save_image(
                image, directory=upload_directory, allowed_extensions=allowed_extensions
            )
        tags = get_or_create_tags(parsed_tags)
        article.title = values["title"]
        article.description = values["description"]
        article.body = values["body"]
        article.category = category
        article.tags = tags
        if new_filename is not None:
            article.image_filename = new_filename
        db.session.commit()
    except Exception:
        try:
            db.session.rollback()
        finally:
            if new_filename is not None:
                remove_unreferenced_image(new_filename, directory=upload_directory)
        raise
    if new_filename is not None and previous_filename:
        remove_unreferenced_image(previous_filename, directory=upload_directory)
    return article


def remove_unreferenced_image(filename, *, directory):
    """Keep the file if its database references cannot be checked safely."""
    try:
        if not is_image_referenced(filename):
            remove_image(filename, directory=directory)
    except (SQLAlchemyError, ValueError):
        db.session.rollback()
        logger.exception("Unable to clean up an unused article image")
