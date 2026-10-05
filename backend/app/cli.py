import sys

from sqlalchemy import select

from .auth import generate_key, key_digest
from .db import BootstrapKey, SessionLocal, User


def main():
    if sys.argv[1:] != ["generate-key"]:
        raise SystemExit("Usage: python -m app.cli generate-key")
    with SessionLocal.begin() as db:
        if db.scalar(select(User.id).where(User.role == "admin", User.deleted_at.is_(None))):
            raise SystemExit("An admin already exists; bootstrap is disabled")
        # Invalidate earlier unredeemed bootstrap keys.
        for old in db.scalars(select(BootstrapKey).where(BootstrapKey.used_at.is_(None))):
            old.used_at = old.updated_at
        key = generate_key()
        db.add(BootstrapKey(key_hash=key_digest(key)))
    print(key)


if __name__ == "__main__":
    main()
