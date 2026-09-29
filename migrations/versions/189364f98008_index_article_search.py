"""Index article title, description, and text for word-based search."""

import sqlalchemy as sa
from alembic import op

revision = "189364f98008"
down_revision = "078253e87007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_articles_search_vector",
        "articles",
        [
            sa.text(
                "to_tsvector('simple'::regconfig, title || ' ' || description || ' ' || text)"
            )
        ],
        postgresql_using="gin",
    )


def downgrade():
    op.drop_index("ix_articles_search_vector", table_name="articles")
