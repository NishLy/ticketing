"""Add persistent ticket identifier and title override tracking.

Revision ID: b913abf42f16
Revises: 5972fdbc4062
"""
from alembic import op
import sqlalchemy as sa


revision = "b913abf42f16"
down_revision = "5972fdbc4062"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("tenants") as batch:
        batch.add_column(sa.Column("identifier_label", sa.String(80), nullable=False, server_default="Company name"))
    with op.batch_alter_table("tickets") as batch:
        batch.add_column(sa.Column("identifier", sa.String(200), nullable=True))
        batch.add_column(sa.Column("title_overridden", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Backfill before making identifier required. Existing titles remain unchanged;
    # changing an identifier later updates an automatically generated title.
    tickets = sa.table("tickets", sa.column("identifier", sa.String(200)), sa.column("title", sa.String(200)))
    op.execute(tickets.update().values(identifier=tickets.c.title))
    with op.batch_alter_table("tickets") as batch:
        batch.alter_column("identifier", existing_type=sa.String(200), nullable=False)
    with op.batch_alter_table("ticket_events") as batch:
        batch.add_column(sa.Column("identifier", sa.String(200), nullable=True))
        batch.add_column(sa.Column("title", sa.String(200), nullable=True))


def downgrade():
    with op.batch_alter_table("ticket_events") as batch:
        batch.drop_column("title")
        batch.drop_column("identifier")
    with op.batch_alter_table("tickets") as batch:
        batch.drop_column("title_overridden")
        batch.drop_column("identifier")
    with op.batch_alter_table("tenants") as batch:
        batch.drop_column("identifier_label")
