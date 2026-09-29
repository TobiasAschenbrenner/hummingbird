"""Add comments with required authors and cascading article references."""

import sqlalchemy as sa
from alembic import op

revision = "29a4750a9009"
down_revision = "189364f98008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("body ~ '[^[:space:]]'", name="comments_body_not_blank"),
        sa.CheckConstraint("char_length(body) <= 2000", name="comments_body_length"),
        sa.ForeignKeyConstraint(
            ["article_id"],
            ["articles.id"],
            name="comments_article_id_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name="comments_author_id_fkey",
            ondelete="RESTRICT",
        ),
    )
    op.create_index("ix_comments_article_id_id", "comments", ["article_id", "id"])
    op.create_index("ix_comments_author_id", "comments", ["author_id"])


def downgrade():
    op.drop_table("comments")
