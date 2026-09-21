"""Replace article category strings with references, preserving existing values."""

import sqlalchemy as sa
from alembic import op

revision = "b24d0f932002"
down_revision = "a13c9e821001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("articles", sa.Column("category_id", sa.Integer(), nullable=True))
    op.execute(
        "INSERT INTO categories (slug, name) "
        "SELECT DISTINCT category, initcap(category) FROM articles "
        "WHERE category IS NOT NULL ON CONFLICT (slug) DO NOTHING"
    )
    op.execute(
        "UPDATE articles SET category_id = categories.id FROM categories "
        "WHERE articles.category = categories.slug"
    )
    op.create_foreign_key(
        "articles_category_id_fkey",
        "articles",
        "categories",
        ["category_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_articles_category_id", "articles", ["category_id"])
    op.drop_column("articles", "category")


def downgrade():
    op.execute(
        "DO $$ BEGIN IF EXISTS ("
        "SELECT 1 FROM articles JOIN categories ON articles.category_id = categories.id "
        "WHERE char_length(categories.slug) > 10"
        ") THEN RAISE EXCEPTION "
        "'Cannot downgrade: an article category slug exceeds the old 10-character limit.'; "
        "END IF; END $$"
    )
    op.add_column("articles", sa.Column("category", sa.String(10), nullable=True))
    op.execute(
        "UPDATE articles SET category = categories.slug FROM categories "
        "WHERE articles.category_id = categories.id"
    )
    op.drop_index("ix_articles_category_id", table_name="articles")
    op.drop_constraint("articles_category_id_fkey", "articles", type_="foreignkey")
    op.drop_column("articles", "category_id")
