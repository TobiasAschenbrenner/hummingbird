import re
from unicodedata import normalize

from sqlalchemy.dialects.postgresql import insert

from app.articles.models import TAG_NAME_MAX_LENGTH, TAG_SLUG_MAX_LENGTH, Tag
from app.errors import ValidationError
from app.extensions import db

MAX_ARTICLE_TAGS = 5
MAX_TAG_INPUT_LENGTH = 250


def parse_tag_names(value):
    if len(value) > MAX_TAG_INPUT_LENGTH:
        raise ValidationError("Please shorten the tags field to 250 characters.")
    tags_by_slug = {}
    for part in value.split(","):
        name = " ".join(normalize("NFKC", part).split())
        if not name:
            continue
        if len(name) > TAG_NAME_MAX_LENGTH:
            raise ValidationError("Each tag must be 40 characters or fewer.")
        if not re.fullmatch(r"[^\W_]+(?:[ -][^\W_]+)*", name):
            raise ValidationError(
                "Use letters, numbers, spaces, or single hyphens in tags."
            )
        slug = name.casefold().replace(" ", "-")
        if len(slug) > TAG_SLUG_MAX_LENGTH:
            raise ValidationError("Please shorten the tag name.")
        tags_by_slug.setdefault(slug, name)
    if len(tags_by_slug) > MAX_ARTICLE_TAGS:
        raise ValidationError("Choose no more than 5 different tags.")
    return tags_by_slug


def get_or_create_tags(names_by_slug):
    """Reuse shared tags without committing the caller's transaction."""
    if not names_by_slug:
        return []
    values = [
        {"slug": slug, "name": name} for slug, name in sorted(names_by_slug.items())
    ]
    db.session.execute(
        insert(Tag).values(values).on_conflict_do_nothing(index_elements=["slug"])
    )
    return (
        Tag.query.filter(Tag.slug.in_(names_by_slug)).order_by(Tag.name, Tag.id).all()
    )
