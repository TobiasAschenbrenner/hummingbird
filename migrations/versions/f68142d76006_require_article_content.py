"""Require nonblank article content without rewriting existing records."""

import sqlalchemy as sa
from alembic import op

revision = "f68142d76006"
down_revision = "e57031c65005"
branch_labels = None
depends_on = None

CONTENT_COLUMNS = (
    ("title", sa.String(55)),
    ("slug", sa.String(80)),
    ("description", sa.String(250)),
    ("text", sa.Text()),
)


def upgrade():
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM articles
                WHERE title IS NULL OR title !~ '[^[:space:]]'
                   OR slug IS NULL OR slug !~ '[^[:space:]]'
                   OR description IS NULL OR description !~ '[^[:space:]]'
                   OR text IS NULL OR text !~ '[^[:space:]]'
            ) THEN
                RAISE EXCEPTION 'Cannot enforce required article content: existing articles contain missing or blank values.'
                    USING HINT = 'Review and correct existing articles before retrying. This migration does not rewrite or delete article data.';
            END IF;
        END $$
        """
    )
    for column, column_type in CONTENT_COLUMNS:
        op.alter_column("articles", column, existing_type=column_type, nullable=False)
        op.create_check_constraint(
            f"articles_{column}_not_blank", "articles", f"{column} ~ '[^[:space:]]'"
        )


def downgrade():
    for column, column_type in reversed(CONTENT_COLUMNS):
        op.drop_constraint(f"articles_{column}_not_blank", "articles", type_="check")
        op.alter_column("articles", column, existing_type=column_type, nullable=True)
