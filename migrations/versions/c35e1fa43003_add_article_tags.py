"""Add tags and the article/tag many-to-many association."""

import sqlalchemy as sa
from alembic import op

revision = "c35e1fa43003"
down_revision = "b24d0f932002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.UniqueConstraint("slug", name="tags_slug_key"),
        sa.CheckConstraint("btrim(name) <> ''", name="tags_name_not_blank"),
        sa.CheckConstraint("btrim(slug) <> ''", name="tags_slug_not_blank"),
    )
    op.create_table(
        "article_tags",
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("article_id", "tag_id"),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_article_tags_tag_id", "article_tags", ["tag_id"])


def downgrade():
    op.drop_index("ix_article_tags_tag_id", table_name="article_tags")
    op.drop_table("article_tags")
    op.drop_table("tags")
