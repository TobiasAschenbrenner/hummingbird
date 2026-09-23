"""Require nonblank user fields without modifying existing records."""

import sqlalchemy as sa
from alembic import op

revision = "d46f20b54004"
down_revision = "c35e1fa43003"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM users
                WHERE username IS NULL OR username !~ '[^[:space:]]'
                   OR email IS NULL OR email !~ '[^[:space:]]'
                   OR password IS NULL OR password !~ '[^[:space:]]'
            ) THEN
                RAISE EXCEPTION 'Cannot enforce required user fields: existing users contain missing or blank values.'
                    USING HINT = 'Review and correct existing users before retrying. This migration does not modify user data.';
            END IF;
        END $$
        """
    )
    for column, length in (("username", 80), ("email", 120), ("password", 250)):
        op.alter_column(
            "users", column, existing_type=sa.String(length), nullable=False
        )
        op.create_check_constraint(
            f"users_{column}_not_blank", "users", f"{column} ~ '[^[:space:]]'"
        )


def downgrade():
    for column, length in (("password", 250), ("email", 120), ("username", 80)):
        op.drop_constraint(f"users_{column}_not_blank", "users", type_="check")
        op.alter_column("users", column, existing_type=sa.String(length), nullable=True)
