import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def now():
    return datetime.now(timezone.utc)


url = os.getenv("DATABASE_URL", "sqlite:///./ticketing.db")
engine = create_engine(url, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {}, pool_pre_ping=True)


@event.listens_for(engine, "connect")
def enable_foreign_keys(connection, _):
    if engine.dialect.name == "sqlite":
        connection.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Tracked:
    created_at = Column(DateTime(timezone=True), default=now, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class Tenant(Tracked, Base):
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    slug = Column(String(80), unique=True, nullable=False)
    identifier_label = Column(String(80), nullable=False, default="Company name")
    api_key_hash = Column(String(64), nullable=True, unique=True)
    api_key_encrypted = Column(Text, nullable=True)
    workspace_name = Column(String(120), nullable=True)
    workspace_icon_name = Column(String(80), nullable=True)


class User(Tracked, Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)  # admin or tenant


class BootstrapKey(Tracked, Base):
    __tablename__ = "bootstrap_keys"
    id = Column(Integer, primary_key=True)
    key_hash = Column(String(64), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)


class MasterField(Tracked, Base):
    __tablename__ = "master_fields"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    key = Column(String(80), nullable=False)
    type = Column(String(20), nullable=False)
    options = Column(Text, nullable=False, default="[]")


class Problem(Tracked, Base):
    __tablename__ = "problems"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_problems_tenant_name"),)
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String(160), nullable=False)
    description = Column(Text, nullable=False, default="")
    status = Column(String(24), nullable=False, default="identified")


class ProblemFile(Tracked, Base):
    __tablename__ = "problem_files"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    problem_id = Column(Integer, ForeignKey("problems.id"), nullable=False, index=True)
    uploaded_file_id = Column(Integer, ForeignKey("uploaded_files.id"), nullable=False, index=True)
    position = Column(Integer, nullable=False, default=0)


class Step(Tracked, Base):
    __tablename__ = "steps"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=False, default="")


class StepField(Tracked, Base):
    __tablename__ = "step_fields"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    step_id = Column(Integer, ForeignKey("steps.id"), nullable=False, index=True)
    field_id = Column(Integer, ForeignKey("master_fields.id"), nullable=False)
    required = Column(Boolean, nullable=False, default=False)
    position = Column(Integer, nullable=False, default=0)


class Ticket(Tracked, Base):
    __tablename__ = "tickets"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    step_id = Column(Integer, ForeignKey("steps.id"), nullable=False, index=True)
    problem_id = Column(Integer, ForeignKey("problems.id"), nullable=True, index=True)
    title = Column(String(200), nullable=False)
    identifier = Column(String(200), nullable=False)
    title_overridden = Column(Boolean, nullable=False, default=False)
    status = Column(String(20), nullable=False, default="open")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    closed_at = Column(DateTime(timezone=True), nullable=True)


class TicketValue(Tracked, Base):
    __tablename__ = "ticket_values"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False, index=True)
    field_id = Column(Integer, ForeignKey("master_fields.id"), nullable=False)
    value = Column(Text, nullable=False)


class TicketEvent(Tracked, Base):
    __tablename__ = "ticket_events"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kind = Column(String(30), nullable=False)
    from_step_id = Column(Integer, nullable=True)
    to_step_id = Column(Integer, nullable=True)
    # Snapshot of the current form (field IDs to values) after this event.
    snapshot = Column(Text, nullable=False)
    # Null on events created before identifiers were introduced.
    identifier = Column(String(200), nullable=True)
    title = Column(String(200), nullable=True)
    problem_id = Column(Integer, ForeignKey("problems.id"), nullable=True, index=True)
    problem_status = Column(String(24), nullable=True)


class UploadedFile(Tracked, Base):
    __tablename__ = "uploaded_files"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    original_name = Column(String(255), nullable=False)
    storage_name = Column(String(80), nullable=False, unique=True)
    content_type = Column(String(120), nullable=False)
    size = Column(Integer, nullable=False)
