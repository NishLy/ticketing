"""Rename the Problem status value to Recurring."""
from alembic import op
import sqlalchemy as sa


revision = "915ba6c7f201"
down_revision = "70c43dd281aa"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    connection.execute(sa.text("UPDATE problems SET status='recurring' WHERE status='reappeared'"))
    connection.execute(sa.text("UPDATE ticket_events SET problem_status='recurring' WHERE problem_status='reappeared'"))
    connection.execute(sa.text("UPDATE ticket_events SET kind='closed_issue_fixed' WHERE kind='closed_problem_fixed'"))


def downgrade():
    connection = op.get_bind()
    connection.execute(sa.text("UPDATE problems SET status='reappeared' WHERE status='recurring'"))
    connection.execute(sa.text("UPDATE ticket_events SET problem_status='reappeared' WHERE problem_status='recurring'"))
    connection.execute(sa.text("UPDATE ticket_events SET kind='closed_problem_fixed' WHERE kind='closed_issue_fixed'"))
