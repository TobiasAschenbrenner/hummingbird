from datetime import date, timedelta

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.security import generate_password_hash

from app.articles.models import Article
from app.articles.queries import list_categories
from app.articles.tags import get_or_create_tags, parse_tag_names
from app.extensions import db
from app.users.models import User

DEMO_EMAIL = "demo@hummingbird.example"
DEMO_TAG_GROUPS = (
    "Getting Started, Tutorials",
    "Databases, Tutorials",
    "Web Development, Databases",
)


def add_demo_articles(*, author, count):
    categories = list_categories()
    if not categories:
        raise click.ClickException(
            "No categories found. Run flask db upgrade before generating demo data."
        )
    existing_slugs = {
        slug
        for (slug,) in db.session.query(Article.slug).filter(
            Article.slug.like("hummingbird-demo-%")
        )
    }
    missing_numbers = [
        number
        for number in range(1, count + 1)
        if f"hummingbird-demo-{number:03d}" not in existing_slugs
    ]
    if not missing_numbers:
        return 0
    tag_groups = [parse_tag_names(group) for group in DEMO_TAG_GROUPS]
    needed_tags = {
        tag_slug: name
        for number in missing_numbers
        for tag_slug, name in tag_groups[(number - 1) % len(tag_groups)].items()
    }
    tags_by_slug = {tag.slug: tag for tag in get_or_create_tags(needed_tags)}
    for number in missing_numbers:
        article_slug = f"hummingbird-demo-{number:03d}"
        category = categories[(number - 1) % len(categories)]
        db.session.add(
            Article(
                title=f"Demo article {number}",
                slug=article_slug,
                description=f"A sample article about {category.name} for local development.",
                body=f"This is demo article {number}.\n\nUse it to explore article pages, authors, and pagination.",
                category=category,
                tags=[
                    tags_by_slug[tag_slug]
                    for tag_slug in tag_groups[(number - 1) % len(tag_groups)]
                ],
                created_at=date(2024, 1, 1) + timedelta(days=number - 1),
                author=author,
            )
        )
    return len(missing_numbers)


@click.command("seed-demo")
@click.option("--count", default=18, show_default=True, type=click.IntRange(1, 1000))
@with_appcontext
def seed_demo(count):
    """Add repeatable sample data to the configured development database."""
    try:
        author = User.query.filter_by(email=DEMO_EMAIL).first()
        created_user = author is None
        if created_user:
            password = click.prompt(
                "Password for the demo account",
                hide_input=True,
                confirmation_prompt=True,
            )
            if len(password) < 8:
                raise click.ClickException(
                    "The password must be at least 8 characters long."
                )
            author = User(
                username="Demo Author",
                email=DEMO_EMAIL,
                password_hash=generate_password_hash(password),
            )
            db.session.add(author)
        created_articles = add_demo_articles(author=author, count=count)
        db.session.commit()
    except SQLAlchemyError as error:
        db.session.rollback()
        current_app.logger.exception("Demo data creation failed")
        raise click.ClickException(
            "Unable to seed the database. Check the connection and run flask db upgrade first."
        ) from error
    except Exception:
        db.session.rollback()
        raise
    click.echo(f"Created {created_articles} articles. Demo account: {DEMO_EMAIL}.")
    if not created_user:
        click.echo(
            "Existing demo account reused; its password and existing articles were not changed."
        )
