"""Add tenant workspace display branding."""
from alembic import op
import sqlalchemy as sa


revision = "01f4d087c9a6"
down_revision = "da805501f675"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("tenants") as batch:
        batch.add_column(sa.Column("workspace_name", sa.String(120), nullable=True))
        batch.add_column(sa.Column("workspace_icon_name", sa.String(80), nullable=True))


def downgrade():
    with op.batch_alter_table("tenants") as batch:
        batch.drop_column("workspace_icon_name")
        batch.drop_column("workspace_name")
