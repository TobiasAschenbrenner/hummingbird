"""Match email identities without case or surrounding ASCII whitespace."""

import sqlalchemy as sa
from alembic import op

revision = "e57031c65005"
down_revision = "d46f20b54004"
branch_labels = None
depends_on = None

EMAIL_KEY_SQL = r"lower(btrim(email, E' \t\n\r\f\013'))"


def upgrade():
    op.execute(
        f"""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM users
                GROUP BY {EMAIL_KEY_SQL}
                HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION 'Cannot enforce email uniqueness: existing accounts have conflicting email addresses.'
                    USING HINT = 'Review the conflicting accounts before retrying. This migration does not merge or delete users.';
            END IF;
        END $$
        """
    )
    op.create_index(
        "ix_users_email_normalized", "users", [sa.text(EMAIL_KEY_SQL)], unique=True
    )
    op.drop_index("ix_users_email", table_name="users")


def downgrade():
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.drop_index("ix_users_email_normalized", table_name="users")
