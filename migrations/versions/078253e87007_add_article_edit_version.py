"""Track article edit versions to reject stale form submissions."""

import sqlalchemy as sa
from alembic import op

revision = "078253e87007"
down_revision = "f68142d76006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "articles",
        sa.Column(
            "version", sa.BigInteger(), nullable=False, server_default=sa.text("1")
        ),
    )
    op.create_check_constraint("articles_version_positive", "articles", "version > 0")


def downgrade():
    op.drop_constraint("articles_version_positive", "articles", type_="check")
    op.drop_column("articles", "version")
