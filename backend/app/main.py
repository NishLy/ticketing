import io
import json
import mimetypes
import os
import re
import secrets
import uuid
from datetime import date as date_type, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit
from PIL import Image, ImageOps, UnidentifiedImageError

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import check_password, create_token, decrypt_api_key, encrypt_api_key, generate_key, hash_password, key_digest, verify_token
from .db import (BootstrapKey, MasterField, SessionLocal, Step, StepField,
                 Tenant, Ticket, TicketEvent, TicketValue, UploadedFile, User, now)

app = FastAPI(title="Ticketing API")


@app.middleware("http")
async def check_origin(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and (urlsplit(origin).scheme not in ("http", "https") or urlsplit(origin).netloc != request.headers.get("host")):
            return Response("Invalid origin", status_code=403)
    return await call_next(request)


def session():
    with SessionLocal() as db:
        yield db


def active(db: Session, model, item_id: int, tenant_id: int | None = None):
    conditions = [model.id == item_id, model.deleted_at.is_(None)]
    if tenant_id is not None:
        conditions.append(model.tenant_id == tenant_id)
    item = db.scalar(select(model).where(*conditions))
    if item is None:
        raise HTTPException(404, "Not found")
    return item


def current_user(request: Request, db: Session = Depends(session)) -> User:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(401, "Login required")
    user = active(db, User, verify_token(token))
    if user.tenant_id is not None:
        active(db, Tenant, user.tenant_id)
    return user


def admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user


def member(user: User = Depends(current_user)) -> User:
    if user.role != "tenant" or user.tenant_id is None:
        raise HTTPException(403, "Tenant access required")
    return user


def iso(value):
    return value.isoformat() + ("Z" if value.tzinfo is None else "") if value else None


def base(item):
    return {"id": item.id, "created_at": iso(item.created_at), "updated_at": iso(item.updated_at), "deleted_at": iso(item.deleted_at)}


def page(db, model, conditions, limit, offset):
    count = db.scalar(select(func.count()).select_from(model).where(*conditions))
    rows = db.scalars(select(model).where(*conditions).order_by(model.created_at.desc(), model.id.desc()).limit(limit).offset(offset)).all()
    return rows, count


def analytics_window(days: int):
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days - 1)
    previous_start = start - timedelta(days=days)
    current_from = datetime.combine(start, time.min, tzinfo=timezone.utc)
    current_until = datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc)
    previous_from = datetime.combine(previous_start, time.min, tzinfo=timezone.utc)
    return start, end, current_from, current_until, previous_from


def event_trends(db: Session, start: date_type, days: int, tenant_id: int | None = None):
    until = start + timedelta(days=days)
    rows = db.execute(
        select(func.date(TicketEvent.created_at), TicketEvent.kind, func.count(TicketEvent.id))
        .join(Ticket, Ticket.id == TicketEvent.ticket_id)
        .where(Ticket.deleted_at.is_(None), TicketEvent.deleted_at.is_(None),
               TicketEvent.created_at >= datetime.combine(start, time.min, tzinfo=timezone.utc),
               TicketEvent.created_at < datetime.combine(until, time.min, tzinfo=timezone.utc),
               *([TicketEvent.tenant_id == tenant_id] if tenant_id is not None else []))
        .group_by(func.date(TicketEvent.created_at), TicketEvent.kind)
    ).all()
    kinds = {"created", "closed", "reopened", "moved"}
    counters = {(start + timedelta(days=i)).isoformat(): {kind: 0 for kind in kinds} for i in range(days)}
    for day, kind, count in rows:
        day_key = day.isoformat() if hasattr(day, "isoformat") else str(day)
        if day_key in counters and kind in kinds:
            counters[day_key][kind] = count
    return [{"date": day, **counters[day]} for day in counters]


def event_count(db: Session, start: datetime, end: datetime, kind: str, tenant_id: int | None = None):
    conditions = [TicketEvent.kind == kind, TicketEvent.deleted_at.is_(None), Ticket.deleted_at.is_(None),
                  TicketEvent.created_at >= start, TicketEvent.created_at < end]
    if tenant_id is not None:
        conditions.append(TicketEvent.tenant_id == tenant_id)
    return db.scalar(select(func.count(TicketEvent.id)).join(Ticket, Ticket.id == TicketEvent.ticket_id).where(*conditions)) or 0


def ticket_status_counts(db: Session, tenant_id: int | None = None):
    conditions = [Ticket.deleted_at.is_(None)]
    if tenant_id is not None:
        conditions.append(Ticket.tenant_id == tenant_id)
    rows = db.execute(select(Ticket.status, func.count(Ticket.id)).where(*conditions).group_by(Ticket.status)).all()
    result = {"open": 0, "closed": 0}
    result.update({status: count for status, count in rows if status in result})
    return result


def analytics_insights(series, created, previous_created):
    event_days = [{"date": row["date"], "total": row["created"] + row["closed"] + row["reopened"] + row["moved"]} for row in series]
    busiest = max(event_days, key=lambda row: row["total"], default=None)
    return {
        "created_change": created - previous_created,
        "created_change_percent": round((created - previous_created) * 100 / previous_created, 1) if previous_created else None,
        "daily_average_created": round(created / len(series), 1) if series else 0,
        "busiest_day": busiest["date"] if busiest and busiest["total"] else None,
        "busiest_day_events": busiest["total"] if busiest else 0,
    }


class Paging(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class Credentials(BaseModel):
    email: str
    password: str


class Bootstrap(Credentials):
    key: str


class TenantInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)


class TenantKeyInput(BaseModel):
    api_key: str = Field(min_length=32, max_length=128)


class UserInput(Credentials):
    tenant_id: int


class FieldInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    key: str = Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=80)
    type: Literal["text", "number", "date", "boolean", "select", "array", "file"]
    options: list[str] = []


class StepFieldInput(BaseModel):
    field_id: int
    required: bool = False


class StepInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    fields: list[StepFieldInput] = []


class TicketInput(BaseModel):
    identifier: str = Field(min_length=1, max_length=200)
    title: str | None = Field(default=None, max_length=200)
    step_id: int
    values: dict[str, Any] = {}


class MoveInput(BaseModel):
    step_id: int
    values: dict[str, Any] = {}


class ValuesInput(BaseModel):
    values: dict[str, Any]


class IdentityInput(BaseModel):
    identifier: str = Field(min_length=1, max_length=200)
    title: str | None = Field(default=None, max_length=200)


class WorkspaceInput(BaseModel):
    identifier_label: str = Field(min_length=1, max_length=80)
    workspace_name: str | None = Field(default=None, max_length=120)


def require_password(value):
    if len(value) < 12:
        raise HTTPException(422, "Password must have at least 12 characters")


@app.post("/api/auth/bootstrap")
def bootstrap(body: Bootstrap, response: Response, db: Session = Depends(session)):
    require_password(body.password)
    if db.scalar(select(User.id).where(User.role == "admin", User.deleted_at.is_(None))):
        raise HTTPException(409, "Admin already exists")
    key = db.scalar(select(BootstrapKey).where(BootstrapKey.key_hash == key_digest(body.key), BootstrapKey.used_at.is_(None)))
    if key is None:
        raise HTTPException(401, "Invalid bootstrap key")
    user = User(email=body.email.strip().lower(), password_hash=hash_password(body.password), role="admin")
    db.add(user)
    key.used_at = now()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email already exists")
    response.set_cookie("session", create_token(user.id), httponly=True, secure=os.getenv("COOKIE_SECURE") == "1", samesite="strict", max_age=86400)
    return {"id": user.id, "role": user.role, "email": user.email}


@app.post("/api/auth/login")
def login(body: Credentials, response: Response, db: Session = Depends(session)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower(), User.deleted_at.is_(None)))
    if not user or not check_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    if user.tenant_id is not None:
        active(db, Tenant, user.tenant_id)
    response.set_cookie("session", create_token(user.id), httponly=True, secure=os.getenv("COOKIE_SECURE") == "1", samesite="strict", max_age=86400)
    return {"id": user.id, "role": user.role, "email": user.email}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("session", samesite="strict")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return {**base(user), "email": user.email, "role": user.role, "tenant_id": user.tenant_id}


@app.get("/api/analytics/tenant")
def tenant_analytics(days: int = Query(default=30, ge=7, le=90),
                     db: Session = Depends(session), user: User = Depends(member)):
    start, end, current_from, current_until, previous_from = analytics_window(days)
    series = event_trends(db, start, days, user.tenant_id)
    current_created = sum(row["created"] for row in series)
    previous_created = event_count(db, previous_from, current_from, "created", user.tenant_id)
    status = ticket_status_counts(db, user.tenant_id)
    step_rows = db.execute(
        select(Step.id, Step.name, func.count(Ticket.id))
        .outerjoin(Ticket, (Ticket.step_id == Step.id) & (Ticket.deleted_at.is_(None)) & (Ticket.tenant_id == user.tenant_id))
        .where(Step.tenant_id == user.tenant_id, Step.deleted_at.is_(None))
        .group_by(Step.id, Step.name).order_by(func.count(Ticket.id).desc(), Step.name)
    ).all()
    by_step = [{"step_id": step_id, "step_name": name, "tickets": count} for step_id, name, count in step_rows]
    insights = analytics_insights(series, current_created, previous_created)
    busiest_step = next((row for row in by_step if row["tickets"]), None)
    insights["busiest_step"] = busiest_step["step_name"] if busiest_step else None
    return {
        "range": {"days": days, "start": start.isoformat(), "end": end.isoformat()},
        "metrics": {"open_tickets": status["open"], "closed_tickets": status["closed"],
                    "created_tickets": current_created, "previous_period_created": previous_created},
        "events": series,
        "tickets_by_step": by_step,
        "insights": insights,
    }


@app.get("/api/admin/analytics")
def platform_analytics(days: int = Query(default=30, ge=7, le=90),
                       db: Session = Depends(session), _: User = Depends(admin)):
    start, end, current_from, current_until, previous_from = analytics_window(days)
    series = event_trends(db, start, days)
    current_created = sum(row["created"] for row in series)
    previous_created = event_count(db, previous_from, current_from, "created")
    status = ticket_status_counts(db)
    active_tenants = db.scalar(select(func.count(Tenant.id)).where(Tenant.deleted_at.is_(None))) or 0
    active_users = db.scalar(select(func.count(User.id)).join(Tenant, Tenant.id == User.tenant_id).where(
        User.role == "tenant", User.deleted_at.is_(None), Tenant.deleted_at.is_(None))) or 0

    tenant_growth = db.execute(select(func.date(Tenant.created_at), func.count(Tenant.id)).where(
        Tenant.deleted_at.is_(None), Tenant.created_at >= current_from, Tenant.created_at < current_until
    ).group_by(func.date(Tenant.created_at))).all()
    user_growth = db.execute(select(func.date(User.created_at), func.count(User.id)).join(
        Tenant, Tenant.id == User.tenant_id).where(User.role == "tenant", User.deleted_at.is_(None),
        Tenant.deleted_at.is_(None), User.created_at >= current_from, User.created_at < current_until
    ).group_by(func.date(User.created_at))).all()
    growth = {(start + timedelta(days=i)).isoformat(): {"new_tenants": 0, "new_users": 0}
              for i in range(days)}
    for day, count in tenant_growth:
        key = day.isoformat() if hasattr(day, "isoformat") else str(day)
        if key in growth:
            growth[key]["new_tenants"] = count
    for day, count in user_growth:
        key = day.isoformat() if hasattr(day, "isoformat") else str(day)
        if key in growth:
            growth[key]["new_users"] = count

    return {
        "range": {"days": days, "start": start.isoformat(), "end": end.isoformat()},
        "metrics": {"active_tenants": active_tenants, "tenant_users": active_users,
                    "open_tickets": status["open"], "closed_tickets": status["closed"],
                    "created_tickets": current_created, "previous_period_created": previous_created},
        "ticket_events": series,
        "account_growth": [{"date": day, **values} for day, values in growth.items()],
        "insights": analytics_insights(series, current_created, previous_created),
    }


def tenant_data(item):
    return {**base(item), "name": item.name, "slug": item.slug, "identifier_label": item.identifier_label}


@app.get("/api/workspace")
def workspace(db: Session = Depends(session), user: User = Depends(member)):
    tenant = active(db, Tenant, user.tenant_id)
    return {**tenant_data(tenant), "identifier_label": tenant.identifier_label,
            "workspace_name": tenant.workspace_name or tenant.name,
            "workspace_icon_url": "/api/workspace/icon" if tenant.workspace_icon_name else None}


@app.put("/api/workspace")
def update_workspace(body: WorkspaceInput, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Tenant, user.tenant_id)
    item.identifier_label = body.identifier_label.strip()
    if not item.identifier_label:
        raise HTTPException(422, "Identifier label is required")
    if "workspace_name" in body.model_fields_set:
        item.workspace_name = body.workspace_name.strip() if body.workspace_name and body.workspace_name.strip() else None
    db.commit()
    return {**tenant_data(item), "identifier_label": item.identifier_label,
            "workspace_name": item.workspace_name or item.name,
            "workspace_icon_url": "/api/workspace/icon" if item.workspace_icon_name else None}


def workspace_icon_dir() -> Path:
    return Path(os.getenv("UPLOAD_DIR", "./uploads")) / "workspace-icons"


@app.post("/api/workspace/icon", status_code=201)
async def upload_workspace_icon(file: UploadFile = File(...), db: Session = Depends(session), user: User = Depends(member)):
    raw = await file.read(5 * 1024 * 1024 + 1)
    if not raw or len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "Workspace icon must be a non-empty image up to 5 MiB")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"}:
                raise HTTPException(415, "Icon must be PNG, JPEG, or WebP")
            if image.width > 8192 or image.height > 8192 or image.width * image.height > 16_000_000:
                raise HTTPException(413, "Image dimensions are too large")
            image.verify()
        with Image.open(io.BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            image = ImageOps.fit(image, (256, 256), method=Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="WEBP", quality=88, method=6)
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "Could not decode the uploaded image")

    directory = workspace_icon_dir()
    directory.mkdir(parents=True, exist_ok=True)
    icon_name = f"{uuid.uuid4().hex}.webp"
    path = directory / icon_name
    path.write_bytes(output.getvalue())
    tenant = active(db, Tenant, user.tenant_id)
    previous_name = tenant.workspace_icon_name
    tenant.workspace_icon_name = icon_name
    tenant.updated_at = now()
    try:
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    if previous_name:
        (directory / previous_name).unlink(missing_ok=True)
    return {"workspace_icon_url": "/api/workspace/icon", "updated_at": iso(tenant.updated_at)}


@app.get("/api/workspace/icon")
def get_workspace_icon(db: Session = Depends(session), user: User = Depends(member)):
    tenant = active(db, Tenant, user.tenant_id)
    if not tenant.workspace_icon_name:
        raise HTTPException(404, "Workspace icon not configured")
    path = workspace_icon_dir() / tenant.workspace_icon_name
    if not path.is_file():
        raise HTTPException(404, "Workspace icon not found")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})


@app.delete("/api/workspace/icon")
def delete_workspace_icon(db: Session = Depends(session), user: User = Depends(member)):
    tenant = active(db, Tenant, user.tenant_id)
    previous_name = tenant.workspace_icon_name
    tenant.workspace_icon_name = None
    tenant.updated_at = now()
    db.commit()
    if previous_name:
        (workspace_icon_dir() / previous_name).unlink(missing_ok=True)
    return {"workspace_icon_url": None}


@app.get("/api/admin/tenants")
def tenants(p: Paging = Depends(), db: Session = Depends(session), _: User = Depends(admin)):
    rows, count = page(db, Tenant, [Tenant.deleted_at.is_(None)], p.limit, p.offset)
    return {"items": [tenant_data(r) for r in rows], "total": count}


@app.post("/api/admin/tenants")
def create_tenant(body: TenantInput, db: Session = Depends(session), _: User = Depends(admin)):
    api_key = generate_key()
    item = Tenant(**body.model_dump(), api_key_hash=key_digest(api_key), api_key_encrypted=encrypt_api_key(api_key))
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Slug already exists")
    return {**tenant_data(item), "api_key": api_key}


@app.put("/api/admin/tenants/{item_id}")
def update_tenant(item_id: int, body: TenantInput, db: Session = Depends(session), _: User = Depends(admin)):
    item = active(db, Tenant, item_id)
    item.name, item.slug = body.name, body.slug
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Slug already exists")
    return tenant_data(item)


@app.delete("/api/admin/tenants/{item_id}")
def delete_tenant(item_id: int, db: Session = Depends(session), _: User = Depends(admin)):
    active(db, Tenant, item_id).deleted_at = now()
    db.commit()
    return {"ok": True}


@app.post("/api/admin/tenants/{item_id}/api-key")
def rotate_tenant_api_key(item_id: int, db: Session = Depends(session), _: User = Depends(admin)):
    item = active(db, Tenant, item_id)
    api_key = generate_key()
    item.api_key_hash = key_digest(api_key)
    item.api_key_encrypted = encrypt_api_key(api_key)
    db.commit()
    return {"tenant_id": item.id, "api_key": api_key}


def user_data(item):
    return {**base(item), "email": item.email, "tenant_id": item.tenant_id}


@app.get("/api/admin/users")
def users(p: Paging = Depends(), db: Session = Depends(session), _: User = Depends(admin)):
    rows, count = page(db, User, [User.role == "tenant", User.deleted_at.is_(None)], p.limit, p.offset)
    return {"items": [user_data(r) for r in rows], "total": count}


@app.post("/api/admin/users")
def create_user(body: UserInput, db: Session = Depends(session), _: User = Depends(admin)):
    active(db, Tenant, body.tenant_id)
    require_password(body.password)
    item = User(tenant_id=body.tenant_id, email=body.email.strip().lower(), password_hash=hash_password(body.password), role="tenant")
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email already exists")
    return user_data(item)


@app.put("/api/admin/users/{item_id}")
def update_user(item_id: int, body: UserInput, db: Session = Depends(session), _: User = Depends(admin)):
    item = active(db, User, item_id)
    if item.role != "tenant":
        raise HTTPException(403, "Cannot edit admin")
    active(db, Tenant, body.tenant_id)
    require_password(body.password)
    item.tenant_id, item.email, item.password_hash = body.tenant_id, body.email.strip().lower(), hash_password(body.password)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email already exists")
    return user_data(item)


@app.delete("/api/admin/users/{item_id}")
def delete_user(item_id: int, db: Session = Depends(session), _: User = Depends(admin)):
    item = active(db, User, item_id)
    if item.role != "tenant":
        raise HTTPException(403, "Cannot delete admin")
    item.deleted_at = now()
    db.commit()
    return {"ok": True}


def field_data(item):
    return {**base(item), "name": item.name, "key": item.key, "type": item.type, "options": json.loads(item.options)}


@app.get("/api/fields")
def fields(p: Paging = Depends(), db: Session = Depends(session), user: User = Depends(member)):
    rows, count = page(db, MasterField, [MasterField.tenant_id == user.tenant_id, MasterField.deleted_at.is_(None)], p.limit, p.offset)
    return {"items": [field_data(r) for r in rows], "total": count}


def validate_field_input(body):
    if body.type == "select" and (not body.options or len(set(body.options)) != len(body.options)):
        raise HTTPException(422, "Select requires unique options")
    if body.type != "select" and body.options:
        raise HTTPException(422, "Options only apply to select fields")


@app.post("/api/fields")
def create_field(body: FieldInput, db: Session = Depends(session), user: User = Depends(member)):
    validate_field_input(body)
    if db.scalar(select(MasterField.id).where(MasterField.tenant_id == user.tenant_id, MasterField.key == body.key)):
        raise HTTPException(409, "Field key already exists")
    item = MasterField(tenant_id=user.tenant_id, name=body.name, key=body.key, type=body.type, options=json.dumps(body.options))
    db.add(item)
    db.commit()
    return field_data(item)


def file_access_url(item: UploadedFile, tenant: Tenant, base_url: str | None = None) -> str:
    if not tenant.api_key_encrypted:
        raise HTTPException(503, "Tenant file API key is not provisioned")
    from urllib.parse import urlencode
    path = f"/api/files/{item.id}/access?{urlencode({'api_key': decrypt_api_key(tenant.api_key_encrypted)})}"
    return f"{base_url.rstrip('/')}{path}" if base_url else path


def file_data(item: UploadedFile, tenant: Tenant):
    return {"file_id": item.id, "name": item.original_name, "size": item.size,
            "content_type": item.content_type, "access_url": file_access_url(item, tenant)}


@app.post("/api/files", status_code=201)
async def upload_file(file: UploadFile = File(...), db: Session = Depends(session), user: User = Depends(member)):
    max_size = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
    content = await file.read(max_size + 1)
    if len(content) > max_size:
        raise HTTPException(413, f"File exceeds the {max_size}-byte upload limit")
    name = os.path.basename((file.filename or "upload").replace("\\", "/")).strip()[:255] or "upload"
    storage_name = uuid.uuid4().hex
    directory = Path(os.getenv("UPLOAD_DIR", "./uploads"))
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / storage_name
    path.write_bytes(content)
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    item = UploadedFile(tenant_id=user.tenant_id, uploaded_by=user.id, original_name=name,
                        storage_name=storage_name, content_type=content_type, size=len(content))
    db.add(item)
    try:
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    tenant = active(db, Tenant, user.tenant_id)
    return file_data(item, tenant)


def tenant_for_api_key(db: Session, api_key: str) -> Tenant:
    if not api_key or len(api_key) > 128:
        raise HTTPException(401, "Tenant API key required")
    candidate = db.scalar(select(Tenant).where(Tenant.api_key_hash == key_digest(api_key), Tenant.deleted_at.is_(None)))
    if candidate is None:
        raise HTTPException(401, "Invalid tenant API key")
    return candidate


@app.get("/api/files/{file_id}/access")
def access_file(file_id: int, api_key: str = Query(..., min_length=32, max_length=128), db: Session = Depends(session)):
    tenant = tenant_for_api_key(db, api_key)
    item = active(db, UploadedFile, file_id, tenant.id)
    path = Path(os.getenv("UPLOAD_DIR", "./uploads")) / item.storage_name
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type=item.content_type, filename=item.original_name,
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@app.put("/api/fields/{item_id}")
def update_field(item_id: int, body: FieldInput, db: Session = Depends(session), user: User = Depends(member)):
    validate_field_input(body)
    item = active(db, MasterField, item_id, user.tenant_id)
    if body.key != item.key or body.type != item.type:
        raise HTTPException(422, "Field key and type cannot change; create a new field instead")
    item.name, item.options = body.name, json.dumps(body.options)
    db.commit()
    return field_data(item)


@app.delete("/api/fields/{item_id}")
def delete_field(item_id: int, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, MasterField, item_id, user.tenant_id)
    if db.scalar(select(StepField.id).where(StepField.field_id == item_id, StepField.deleted_at.is_(None))):
        raise HTTPException(409, "Remove this field from steps first")
    item.deleted_at = now()
    db.commit()
    return {"ok": True}


def step_data(db, item):
    bindings = db.scalars(select(StepField).where(StepField.step_id == item.id, StepField.deleted_at.is_(None)).order_by(StepField.position)).all()
    return {**base(item), "name": item.name, "description": item.description,
            "fields": [{"field_id": b.field_id, "required": b.required} for b in bindings]}


@app.get("/api/steps")
def steps(p: Paging = Depends(), db: Session = Depends(session), user: User = Depends(member)):
    rows, count = page(db, Step, [Step.tenant_id == user.tenant_id, Step.deleted_at.is_(None)], p.limit, p.offset)
    return {"items": [step_data(db, r) for r in rows], "total": count}


def set_step_fields(db, item, bindings, tenant_id):
    ids = [b.field_id for b in bindings]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "A field may appear only once in a step")
    for field_id in ids:
        active(db, MasterField, field_id, tenant_id)
    for old in db.scalars(select(StepField).where(StepField.step_id == item.id, StepField.deleted_at.is_(None))):
        old.deleted_at = now()
    for position, binding in enumerate(bindings):
        db.add(StepField(tenant_id=tenant_id, step_id=item.id, field_id=binding.field_id, required=binding.required, position=position))


@app.post("/api/steps")
def create_step(body: StepInput, db: Session = Depends(session), user: User = Depends(member)):
    item = Step(tenant_id=user.tenant_id, name=body.name, description=body.description)
    db.add(item)
    db.flush()
    set_step_fields(db, item, body.fields, user.tenant_id)
    db.commit()
    return step_data(db, item)


@app.put("/api/steps/{item_id}")
def update_step(item_id: int, body: StepInput, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Step, item_id, user.tenant_id)
    old = [(b.field_id, b.required) for b in db.scalars(select(StepField).where(StepField.step_id == item.id, StepField.deleted_at.is_(None)).order_by(StepField.position))]
    new = [(b.field_id, b.required) for b in body.fields]
    if old != new and db.scalar(select(Ticket.id).where(Ticket.step_id == item_id, Ticket.deleted_at.is_(None), Ticket.status == "open")):
        raise HTTPException(409, "Cannot change fields while open tickets are at this step")
    item.name, item.description = body.name, body.description
    if old != new:
        set_step_fields(db, item, body.fields, user.tenant_id)
    db.commit()
    return step_data(db, item)


@app.delete("/api/steps/{item_id}")
def delete_step(item_id: int, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Step, item_id, user.tenant_id)
    if db.scalar(select(Ticket.id).where(Ticket.step_id == item_id, Ticket.deleted_at.is_(None))):
        raise HTTPException(409, "Step is used by tickets")
    item.deleted_at = now()
    db.commit()
    return {"ok": True}


def bindings_for(db, step_id):
    return db.scalars(select(StepField).where(StepField.step_id == step_id, StepField.deleted_at.is_(None)).order_by(StepField.position)).all()


def values_for(db, ticket_id):
    return {str(row.field_id): json.loads(row.value) for row in db.scalars(select(TicketValue).where(TicketValue.ticket_id == ticket_id, TicketValue.deleted_at.is_(None)))}


def validated_values(db, step_id, tenant_id, values):
    bindings = bindings_for(db, step_id)
    allowed = {str(b.field_id): b for b in bindings}
    if set(values) - set(allowed):
        raise HTTPException(422, "Values contain fields outside this step")
    for key, value in values.items():
        field = active(db, MasterField, allowed[key].field_id, tenant_id)
        if value is None or value == "":
            continue
        valid = {"text": lambda: isinstance(value, str),
                 "number": lambda: isinstance(value, (int, float)) and not isinstance(value, bool),
                 "date": lambda: isinstance(value, str) and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)),
                 "boolean": lambda: isinstance(value, bool),
                 "select": lambda: isinstance(value, str) and value in json.loads(field.options),
                 "array": lambda: isinstance(value, list) and all(isinstance(v, str) for v in value),
                 "file": lambda: isinstance(value, dict) and isinstance(value.get("file_id"), int) and db.scalar(select(UploadedFile.id).where(UploadedFile.id == value["file_id"], UploadedFile.tenant_id == tenant_id, UploadedFile.deleted_at.is_(None))) is not None}[field.type]()
        if not valid:
            raise HTTPException(422, f"Invalid value for {field.name}")
        if field.type == "date":
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(422, f"Invalid date for {field.name}")
        if field.type == "file" and value not in (None, ""):
            file_record = db.scalar(select(UploadedFile).where(UploadedFile.id == value["file_id"],
                UploadedFile.tenant_id == tenant_id, UploadedFile.deleted_at.is_(None)))
            if file_record is None:
                raise HTTPException(422, f"File for {field.name} is unavailable to this tenant")
            values[key] = {"file_id": file_record.id, "name": file_record.original_name,
                           "size": file_record.size, "content_type": file_record.content_type}
    for key, binding in allowed.items():
        if binding.required and (values.get(key) in (None, "") or values.get(key) == []):
            raise HTTPException(422, f"Required field {key} is missing")
    return values


def replace_values(db, ticket, values):
    for old in db.scalars(select(TicketValue).where(TicketValue.ticket_id == ticket.id, TicketValue.deleted_at.is_(None))):
        old.deleted_at = now()
    for key, value in values.items():
        if value is not None and value != "":
            db.add(TicketValue(tenant_id=ticket.tenant_id, ticket_id=ticket.id, field_id=int(key), value=json.dumps(value)))


def event(db, ticket, user, kind, previous, values):
    db.add(TicketEvent(tenant_id=ticket.tenant_id, ticket_id=ticket.id, actor_id=user.id, kind=kind,
                       from_step_id=previous, to_step_id=ticket.step_id, snapshot=json.dumps(values),
                       identifier=ticket.identifier, title=ticket.title))


def identity(identifier: str, title: str | None):
    identifier = identifier.strip()
    if not identifier:
        raise HTTPException(422, "Identifier is required")
    title = title.strip() if title is not None else ""
    if len(identifier) > 200 or len(title) > 200:
        raise HTTPException(422, "Identifier and title must be at most 200 characters")
    return identifier, title or identifier, bool(title and title != identifier)


def ticket_data(item):
    return {**base(item), "title": item.title, "identifier": item.identifier,
            "title_overridden": item.title_overridden, "step_id": item.step_id, "status": item.status,
            "closed_at": iso(item.closed_at), "created_by": item.created_by}


def ticket_detail(db, item):
    values = values_for(db, item.id)
    file_values = {int(key): value for key, value in values.items() if isinstance(value, dict) and "file_id" in value}
    if file_values:
        tenant = active(db, Tenant, item.tenant_id)
        for key, value in file_values.items():
            uploaded = db.scalar(select(UploadedFile).where(UploadedFile.id == value["file_id"],
                UploadedFile.tenant_id == item.tenant_id, UploadedFile.deleted_at.is_(None)))
            if uploaded:
                values[str(key)] = file_data(uploaded, tenant)
    event_steps = {s.id: s.name for s in db.scalars(select(Step).where(Step.tenant_id == item.tenant_id))}
    event_fields = {f.id: f.name for f in db.scalars(select(MasterField).where(MasterField.tenant_id == item.tenant_id))}
    event_actors = {actor.id: actor.email for actor in db.scalars(select(User).where(User.tenant_id == item.tenant_id))}
    return {**ticket_data(item), "values": values, "events": [
        {**base(e), "actor_id": e.actor_id, "kind": e.kind, "from_step_id": e.from_step_id,
         "to_step_id": e.to_step_id, "snapshot": json.loads(e.snapshot),
         "identifier": e.identifier, "title": e.title,
         "actor_name": event_actors.get(e.actor_id),
         "from_step_name": event_steps.get(e.from_step_id), "to_step_name": event_steps.get(e.to_step_id),
         "snapshot_fields": {str(field_id): event_fields[int(field_id)] for field_id in json.loads(e.snapshot) if int(field_id) in event_fields}}
        for e in db.scalars(select(TicketEvent).where(TicketEvent.ticket_id == item.id).order_by(TicketEvent.created_at, TicketEvent.id))]}


def ticket_conditions(tenant_id, step_ids, status, search=""):
    conditions = [Ticket.tenant_id == tenant_id, Ticket.deleted_at.is_(None)]
    if step_ids:
        conditions.append(Ticket.step_id.in_(step_ids))
    if status:
        conditions.append(Ticket.status == status)
    if search:
        conditions.append(Ticket.identifier.contains(search, autoescape=True))
    return conditions


@app.get("/api/tickets")
def tickets(step_ids: list[int] = Query(default=[]), status: Literal["open", "closed"] | None = None,
            search: str = Query(default="", max_length=200), p: Paging = Depends(),
            db: Session = Depends(session), user: User = Depends(member)):
    rows, count = page(db, Ticket, ticket_conditions(user.tenant_id, step_ids, status, search.strip()), p.limit, p.offset)
    return {"items": [ticket_data(r) for r in rows], "total": count}


@app.get("/api/tickets/export")
def export_tickets(request: Request, step_ids: list[int] = Query(default=[]), status: Literal["open", "closed"] | None = None,
                   search: str = Query(default="", max_length=200),
                   db: Session = Depends(session), user: User = Depends(member)):
    rows = db.scalars(select(Ticket).where(*ticket_conditions(user.tenant_id, step_ids, status, search.strip())).order_by(Ticket.created_at.desc(), Ticket.id.desc())).all()
    tenant = active(db, Tenant, user.tenant_id)
    identifier_label = tenant.identifier_label
    step_names = {s.id: s.name for s in db.scalars(select(Step).where(Step.tenant_id == user.tenant_id))}
    field_names = {f.id: f.name for f in db.scalars(select(MasterField).where(MasterField.tenant_id == user.tenant_id))}
    field_ids = sorted({int(key) for row in rows for key in values_for(db, row.id)})
    book = Workbook()
    sheet = book.active
    sheet.title = "Tickets"
    def safe(value):
        text = str(value)
        return "'" + text if text.startswith(("=", "+", "-", "@")) else text

    sheet.append(["ID", safe(identifier_label), "Title", "Step", "Status", "Created at", "Updated at", "Closed at"] + [safe(field_names.get(i, str(i))) for i in field_ids])
    for row in rows:
        values = values_for(db, row.id)
        def export_value(value):
            if isinstance(value, list):
                return ", ".join(map(str, value))
            if isinstance(value, dict) and value.get("access_url"):
                return value["access_url"]
            if isinstance(value, dict) and value.get("file_id"):
                uploaded = db.scalar(select(UploadedFile).where(UploadedFile.id == value["file_id"],
                    UploadedFile.tenant_id == user.tenant_id, UploadedFile.deleted_at.is_(None)))
                if uploaded:
                    return file_access_url(uploaded, tenant, str(request.base_url))
            return value

        sheet.append([row.id, safe(row.identifier), safe(row.title), safe(step_names.get(row.step_id, "")), row.status, iso(row.created_at), iso(row.updated_at), iso(row.closed_at)] +
                     [safe(export_value(values.get(str(i), ""))) for i in field_ids])
    buffer = io.BytesIO()
    book.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": 'attachment; filename="tickets.xlsx"'})


@app.post("/api/tickets")
def create_ticket(body: TicketInput, db: Session = Depends(session), user: User = Depends(member)):
    active(db, Step, body.step_id, user.tenant_id)
    values = validated_values(db, body.step_id, user.tenant_id, body.values)
    identifier, title, overridden = identity(body.identifier, body.title)
    item = Ticket(tenant_id=user.tenant_id, step_id=body.step_id, identifier=identifier,
                  title=title, title_overridden=overridden, created_by=user.id)
    db.add(item)
    db.flush()
    replace_values(db, item, values)
    event(db, item, user, "created", None, values)
    db.commit()
    return ticket_detail(db, item)


@app.get("/api/tickets/{item_id}")
def get_ticket(item_id: int, db: Session = Depends(session), user: User = Depends(member)):
    return ticket_detail(db, active(db, Ticket, item_id, user.tenant_id))


@app.put("/api/tickets/{item_id}/values")
def edit_ticket(item_id: int, body: ValuesInput, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Ticket, item_id, user.tenant_id)
    if item.status != "open":
        raise HTTPException(409, "Ticket is closed")
    values = validated_values(db, item.step_id, user.tenant_id, body.values)
    replace_values(db, item, values)
    item.updated_at = now()
    event(db, item, user, "edited", item.step_id, values)
    db.commit()
    return ticket_detail(db, item)


@app.put("/api/tickets/{item_id}/identity")
def update_identity(item_id: int, body: IdentityInput, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Ticket, item_id, user.tenant_id)
    if item.status != "open":
        raise HTTPException(409, "Ticket is closed")
    # Passing the current manual title retains an override; null/empty resets it.
    identifier, title, overridden = identity(body.identifier, body.title)
    if (item.identifier, item.title, item.title_overridden) != (identifier, title, overridden):
        item.identifier, item.title, item.title_overridden = identifier, title, overridden
        item.updated_at = now()
        event(db, item, user, "identity_updated", item.step_id, values_for(db, item.id))
        db.commit()
    return ticket_detail(db, item)


@app.post("/api/tickets/{item_id}/move")
def move_ticket(item_id: int, body: MoveInput, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Ticket, item_id, user.tenant_id)
    if item.status != "open":
        raise HTTPException(409, "Ticket is closed")
    active(db, Step, body.step_id, user.tenant_id)
    if item.step_id == body.step_id:
        raise HTTPException(422, "Choose a different step")
    allowed = {str(b.field_id) for b in bindings_for(db, body.step_id)}
    shared = {key: value for key, value in values_for(db, item.id).items() if key in allowed}
    values = validated_values(db, body.step_id, user.tenant_id, {**shared, **body.values})
    previous = item.step_id
    item.step_id = body.step_id
    item.updated_at = now()
    replace_values(db, item, values)
    event(db, item, user, "moved", previous, values)
    db.commit()
    return ticket_detail(db, item)


@app.post("/api/tickets/{item_id}/close")
def close_ticket(item_id: int, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Ticket, item_id, user.tenant_id)
    if item.status != "open":
        raise HTTPException(409, "Ticket is closed")
    item.status, item.closed_at, item.updated_at = "closed", now(), now()
    event(db, item, user, "closed", item.step_id, values_for(db, item.id))
    db.commit()
    return ticket_detail(db, item)


@app.post("/api/tickets/{item_id}/reopen")
def reopen_ticket(item_id: int, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Ticket, item_id, user.tenant_id)
    if item.status != "closed":
        raise HTTPException(409, "Only closed tickets can be reopened")
    item.status, item.closed_at, item.updated_at = "open", None, now()
    event(db, item, user, "reopened", item.step_id, values_for(db, item.id))
    db.commit()
    return ticket_detail(db, item)


@app.delete("/api/tickets/{item_id}")
def delete_ticket(item_id: int, db: Session = Depends(session), user: User = Depends(member)):
    item = active(db, Ticket, item_id, user.tenant_id)
    item.deleted_at = now()
    event(db, item, user, "deleted", item.step_id, values_for(db, item.id))
    db.commit()
    return {"ok": True}
