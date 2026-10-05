"""Add tenant API credentials and tenant-owned uploaded files."""
from alembic import op
import sqlalchemy as sa


revision = "da805501f675"
down_revision = "b913abf42f16"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("tenants") as batch:
        batch.add_column(sa.Column("api_key_hash", sa.String(64), nullable=True))
        batch.add_column(sa.Column("api_key_encrypted", sa.Text(), nullable=True))
        batch.create_unique_constraint("uq_tenants_api_key_hash", ["api_key_hash"])
    op.create_table(
        "uploaded_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("storage_name", sa.String(80), nullable=False),
        sa.Column("content_type", sa.String(120), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_name"),
    )
    with op.batch_alter_table("uploaded_files") as batch:
        batch.create_index("ix_uploaded_files_created_at", ["created_at"])
        batch.create_index("ix_uploaded_files_tenant_id", ["tenant_id"])


def downgrade():
    with op.batch_alter_table("uploaded_files") as batch:
        batch.drop_index("ix_uploaded_files_tenant_id")
        batch.drop_index("ix_uploaded_files_created_at")
    op.drop_table("uploaded_files")
    with op.batch_alter_table("tenants") as batch:
        batch.drop_constraint("uq_tenants_api_key_hash", type_="unique")
        batch.drop_column("api_key_encrypted")
        batch.drop_column("api_key_hash")
