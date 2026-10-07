"""Add tenant problem master records and their generated workflow steps."""
from alembic import op
import sqlalchemy as sa


revision = "57d29b13a4ce"
down_revision = "01f4d087c9a6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "problems",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_problems_tenant_name"),
    )
    with op.batch_alter_table("problems") as batch:
        batch.create_index("ix_problems_tenant_id", ["tenant_id"])
        batch.create_index("ix_problems_created_at", ["created_at"])
    with op.batch_alter_table("steps") as batch:
        batch.add_column(sa.Column("problem_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_steps_problem_id_problems", "problems", ["problem_id"], ["id"])
        batch.create_index("ix_steps_problem_id", ["problem_id"], unique=True)
    op.create_table(
        "ticket_problems",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("problem_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"]),
        sa.ForeignKeyConstraint(["problem_id"], ["problems.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("ticket_problems") as batch:
        batch.create_index("ix_ticket_problems_tenant_id", ["tenant_id"])
        batch.create_index("ix_ticket_problems_ticket_id", ["ticket_id"])
        batch.create_index("ix_ticket_problems_problem_id", ["problem_id"])
        batch.create_index("ix_ticket_problems_created_at", ["created_at"])


def downgrade():
    with op.batch_alter_table("ticket_problems") as batch:
        batch.drop_index("ix_ticket_problems_created_at")
        batch.drop_index("ix_ticket_problems_problem_id")
        batch.drop_index("ix_ticket_problems_ticket_id")
        batch.drop_index("ix_ticket_problems_tenant_id")
    op.drop_table("ticket_problems")
    with op.batch_alter_table("steps") as batch:
        batch.drop_index("ix_steps_problem_id")
        batch.drop_constraint("fk_steps_problem_id_problems", type_="foreignkey")
        batch.drop_column("problem_id")
    with op.batch_alter_table("problems") as batch:
        batch.drop_index("ix_problems_created_at")
        batch.drop_index("ix_problems_tenant_id")
    op.drop_table("problems")
