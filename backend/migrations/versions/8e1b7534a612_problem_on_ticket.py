"""Store Problem association directly on tickets; remove generated-step links."""
from alembic import op
import sqlalchemy as sa
import json


revision = "8e1b7534a612"
down_revision = "57d29b13a4ce"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("tickets", sa.Column("problem_id", sa.Integer(), nullable=True))
    with op.batch_alter_table("tickets") as batch:
        batch.create_foreign_key("fk_tickets_problem_id_problems", "problems", ["problem_id"], ["id"])
        batch.create_index("ix_tickets_problem_id", ["problem_id"])

    connection = op.get_bind()
    # Preserve the current Problem association from existing active ticket links.
    links = connection.execute(sa.text(
        "SELECT ticket_id, problem_id FROM ticket_problems WHERE deleted_at IS NULL ORDER BY id"
    )).all()
    latest = {}
    for ticket_id, problem_id in links:
        latest[ticket_id] = problem_id
    for ticket_id, problem_id in latest.items():
        connection.execute(sa.text(
            "UPDATE tickets SET problem_id=:problem_id WHERE id=:ticket_id AND problem_id IS NULL"
        ), {"ticket_id": ticket_id, "problem_id": problem_id})

    # Older ticket saves may have the Problem only in the custom-field JSON value.
    problem_fields = connection.execute(sa.text(
        "SELECT id FROM master_fields WHERE type='problem'"
    )).scalars().all()
    if problem_fields:
        value_rows = connection.execute(sa.text(
            "SELECT ticket_id, field_id, value FROM ticket_values WHERE deleted_at IS NULL"
        )).all()
        for ticket_id, field_id, raw_value in value_rows:
            if field_id not in problem_fields:
                continue
            try:
                problem_id = json.loads(raw_value)
            except (TypeError, ValueError):
                continue
            if type(problem_id) is int:
                connection.execute(sa.text(
                    "UPDATE tickets SET problem_id=:problem_id WHERE id=:ticket_id AND problem_id IS NULL"
                ), {"ticket_id": ticket_id, "problem_id": problem_id})
        connection.execute(sa.text(
            "UPDATE ticket_values SET deleted_at=CURRENT_TIMESTAMP "
            "WHERE deleted_at IS NULL AND field_id IN :field_ids"
        ).bindparams(sa.bindparam("field_ids", expanding=True)), {"field_ids": problem_fields})

    with op.batch_alter_table("ticket_events") as batch:
        batch.add_column(sa.Column("problem_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("problem_status", sa.String(length=24), nullable=True))
        batch.create_foreign_key("fk_ticket_events_problem_id_problems", "problems", ["problem_id"], ["id"])
        batch.create_index("ix_ticket_events_problem_id", ["problem_id"])
    connection.execute(sa.text(
        "UPDATE ticket_events SET problem_id=(SELECT tickets.problem_id FROM tickets "
        "WHERE tickets.id=ticket_events.ticket_id), problem_status=(SELECT problems.status FROM problems "
        "JOIN tickets ON tickets.problem_id=problems.id WHERE tickets.id=ticket_events.ticket_id)"
    ))

    op.drop_table("ticket_problems")
    with op.batch_alter_table("steps") as batch:
        batch.drop_index("ix_steps_problem_id")
        batch.drop_constraint("fk_steps_problem_id_problems", type_="foreignkey")
        batch.drop_column("problem_id")


def downgrade():
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
    connection = op.get_bind()
    rows = connection.execute(sa.text(
        "SELECT tickets.id, tickets.tenant_id, tickets.problem_id, tickets.created_at, tickets.updated_at "
        "FROM tickets WHERE tickets.problem_id IS NOT NULL"
    )).all()
    for ticket_id, tenant_id, problem_id, created_at, updated_at in rows:
        connection.execute(sa.text(
            "INSERT INTO ticket_problems (tenant_id, ticket_id, problem_id, created_at, updated_at) "
            "VALUES (:tenant_id, :ticket_id, :problem_id, :created_at, :updated_at)"
        ), {"tenant_id": tenant_id, "ticket_id": ticket_id, "problem_id": problem_id,
            "created_at": created_at, "updated_at": updated_at})
    with op.batch_alter_table("ticket_events") as batch:
        batch.drop_index("ix_ticket_events_problem_id")
        batch.drop_constraint("fk_ticket_events_problem_id_problems", type_="foreignkey")
        batch.drop_column("problem_status")
        batch.drop_column("problem_id")
    with op.batch_alter_table("tickets") as batch:
        batch.drop_index("ix_tickets_problem_id")
        batch.drop_constraint("fk_tickets_problem_id_problems", type_="foreignkey")
        batch.drop_column("problem_id")
