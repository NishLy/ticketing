"""Idempotently provision the StelinaCS tenant and seed its reported issues."""
import json
import os
from pathlib import Path

from sqlalchemy import select

from .auth import encrypt_api_key, generate_key, hash_password, key_digest
from .db import (MasterField, SessionLocal, Step, StepField, Tenant, Ticket,
                 TicketEvent, TicketValue, User, now)


DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "stelinacs_seed.json"


def seed(password: str) -> dict[str, int | bool]:
    if len(password) < 12:
        raise ValueError("STELINACS_PASSWORD must have at least 12 characters")
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    counts = {"tickets_created": 0, "tickets_existing": 0, "steps_created": 0, "api_key_created": False}

    with SessionLocal.begin() as db:
        tenant_data = data["tenant"]
        tenant = db.scalar(select(Tenant).where(Tenant.slug == tenant_data["slug"]))
        if tenant is None:
            api_key = generate_key()
            tenant = Tenant(**tenant_data, api_key_hash=key_digest(api_key), api_key_encrypted=encrypt_api_key(api_key))
            db.add(tenant)
            db.flush()
            counts["api_key_created"] = True
            print(f"New tenant API key (copy now): {api_key}")
        else:
            tenant.deleted_at = None
            tenant.name = tenant_data["name"]
            tenant.identifier_label = tenant_data["identifier_label"]
            if not tenant.api_key_hash:
                api_key = generate_key()
                tenant.api_key_hash = key_digest(api_key)
                tenant.api_key_encrypted = encrypt_api_key(api_key)
                counts["api_key_created"] = True
                print(f"New tenant API key (copy now): {api_key}")

        user_data = data["user"]
        user = db.scalar(select(User).where(User.email == user_data["email"].lower()))
        if user is None:
            user = User(tenant_id=tenant.id, email=user_data["email"].lower(),
                        password_hash=hash_password(password), role="tenant")
            db.add(user)
            db.flush()
        elif user.role != "tenant" or user.tenant_id not in (None, tenant.id):
            raise ValueError(f"{user.email} already belongs to a different account/tenant")
        else:
            user.tenant_id = tenant.id
            user.deleted_at = None
            user.password_hash = hash_password(password)

        fields: dict[str, MasterField] = {}
        for field_data in data["fields"]:
            field = db.scalar(select(MasterField).where(
                MasterField.tenant_id == tenant.id, MasterField.key == field_data["key"]))
            if field is None:
                field = MasterField(tenant_id=tenant.id, name=field_data["name"], key=field_data["key"],
                                    type=field_data["type"], options=json.dumps(field_data.get("options", [])))
                db.add(field)
                db.flush()
            else:
                field.deleted_at = None
                field.name = field_data["name"]
                field.type = field_data["type"]
                field.options = json.dumps(field_data.get("options", []))
            fields[field_data["key"]] = field

        steps: dict[str, Step] = {}
        for category in data["steps"]:
            step = db.scalar(select(Step).where(Step.tenant_id == tenant.id, Step.name == category))
            if step is None:
                step = Step(tenant_id=tenant.id, name=category,
                            description=f"Kendala StelinaCS: {category}.")
                db.add(step)
                db.flush()
                counts["steps_created"] += 1
            else:
                step.deleted_at = None
                step.description = f"Kendala StelinaCS: {category}."
            steps[category] = step

            for position, field_key in enumerate(("nib", "no_aju", "no_pib")):
                field = fields[field_key]
                binding = db.scalar(select(StepField).where(
                    StepField.step_id == step.id, StepField.field_id == field.id, StepField.deleted_at.is_(None)))
                if binding is None:
                    db.add(StepField(tenant_id=tenant.id, step_id=step.id, field_id=field.id,
                                     required=False, position=position))
                else:
                    binding.required = False
                    binding.position = position

        legacy_category_field = db.scalar(select(MasterField).where(
            MasterField.tenant_id == tenant.id, MasterField.key == "jenis_kendala",
            MasterField.deleted_at.is_(None)))
        if legacy_category_field:
            for binding in db.scalars(select(StepField).where(
                    StepField.field_id == legacy_category_field.id, StepField.deleted_at.is_(None))):
                binding.deleted_at = now()

        for report in data["tickets"]:
            expected_values = {
                str(fields["nib"].id): report["nib"],
            }
            if report.get("no_aju"):
                expected_values[str(fields["no_aju"].id)] = report["no_aju"]
            if report.get("no_pib"):
                expected_values[str(fields["no_pib"].id)] = report["no_pib"]

            ticket = db.scalar(select(Ticket).where(
                Ticket.tenant_id == tenant.id, Ticket.identifier == report["company"],
                Ticket.title == report["category"], Ticket.deleted_at.is_(None)))
            step = steps[report["category"]]
            if ticket is None:
                ticket = Ticket(tenant_id=tenant.id, step_id=step.id, title=report["category"],
                                identifier=report["company"], title_overridden=True, status="open",
                                created_by=user.id)
                db.add(ticket)
                db.flush()
                for key, value in expected_values.items():
                    db.add(TicketValue(tenant_id=tenant.id, ticket_id=ticket.id,
                                       field_id=int(key), value=json.dumps(value, ensure_ascii=False)))
                db.add(TicketEvent(tenant_id=tenant.id, ticket_id=ticket.id, actor_id=user.id,
                                   kind="created", from_step_id=None, to_step_id=step.id,
                                   snapshot=json.dumps(expected_values, ensure_ascii=False),
                                   identifier=ticket.identifier, title=ticket.title))
                counts["tickets_created"] += 1
                continue

            counts["tickets_existing"] += 1
            previous_step_id = ticket.step_id
            step_changed = previous_step_id != step.id
            ticket.step_id = step.id
            active_values = db.scalars(select(TicketValue).where(
                TicketValue.ticket_id == ticket.id, TicketValue.deleted_at.is_(None))).all()
            obsolete_values = [row for row in active_values if legacy_category_field and row.field_id == legacy_category_field.id]
            actual_values = {str(row.field_id): json.loads(row.value) for row in active_values if row not in obsolete_values}
            values_changed = actual_values != expected_values or bool(obsolete_values)
            if step_changed or values_changed:
                for row in active_values:
                    row.deleted_at = now()
                for key, value in expected_values.items():
                    db.add(TicketValue(tenant_id=tenant.id, ticket_id=ticket.id,
                                       field_id=int(key), value=json.dumps(value, ensure_ascii=False)))
                db.add(TicketEvent(tenant_id=tenant.id, ticket_id=ticket.id, actor_id=user.id,
                                   kind="moved" if step_changed else "seed_updated",
                                   from_step_id=previous_step_id if step_changed else step.id, to_step_id=step.id,
                                   snapshot=json.dumps(expected_values, ensure_ascii=False),
                                   identifier=ticket.identifier, title=ticket.title))

        legacy_step = db.scalar(select(Step).where(
            Step.tenant_id == tenant.id, Step.name == "Pelaporan Kendala", Step.deleted_at.is_(None)))
        if legacy_step and not db.scalar(select(Ticket.id).where(
                Ticket.tenant_id == tenant.id, Ticket.step_id == legacy_step.id, Ticket.deleted_at.is_(None))):
            legacy_step.deleted_at = now()
        if legacy_category_field:
            legacy_category_field.deleted_at = now()

    return counts


def main():
    password = os.getenv("STELINACS_PASSWORD")
    if not password:
        raise SystemExit("Set STELINACS_PASSWORD before running this seed command.")
    result = seed(password)
    print("StelinaCS seed complete: " + ", ".join(f"{key}={value}" for key, value in result.items()))


if __name__ == "__main__":
    main()
