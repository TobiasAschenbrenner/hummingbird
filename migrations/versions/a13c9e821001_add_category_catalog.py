"""Add the category catalog and the three existing choices."""

import sqlalchemy as sa
from alembic import op

revision = "a13c9e821001"
down_revision = "b5c595757bd0"
branch_labels = None
depends_on = None


def upgrade():
    categories = op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.UniqueConstraint("slug", name="categories_slug_key"),
    )
    op.bulk_insert(
        categories,
        [
            {"slug": "design", "name": "Design"},
            {"slug": "tech", "name": "Tech"},
            {"slug": "mobile", "name": "Mobile"},
        ],
    )


def downgrade():
    op.drop_table("categories")
