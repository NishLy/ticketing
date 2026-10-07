"""Allow Problems to reference uploaded tenant files."""
from alembic import op
import sqlalchemy as sa


revision = "70c43dd281aa"
down_revision = "8e1b7534a612"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "problem_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_file_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["problem_id"], ["problems.id"]),
        sa.ForeignKeyConstraint(["uploaded_file_id"], ["uploaded_files.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("problem_files") as batch:
        batch.create_index("ix_problem_files_tenant_id", ["tenant_id"])
        batch.create_index("ix_problem_files_problem_id", ["problem_id"])
        batch.create_index("ix_problem_files_uploaded_file_id", ["uploaded_file_id"])
        batch.create_index("ix_problem_files_created_at", ["created_at"])


def downgrade():
    with op.batch_alter_table("problem_files") as batch:
        batch.drop_index("ix_problem_files_created_at")
        batch.drop_index("ix_problem_files_uploaded_file_id")
        batch.drop_index("ix_problem_files_problem_id")
        batch.drop_index("ix_problem_files_tenant_id")
    op.drop_table("problem_files")
