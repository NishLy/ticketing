import hashlib
import os
import secrets
import base64
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.fernet import Fernet
from fastapi import HTTPException
from pwdlib import PasswordHash


password_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def check_password(password: str, stored: str) -> bool:
    return password_hasher.verify(password, stored)


def key_digest(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def encrypt_api_key(key: str) -> str:
    derived = base64.urlsafe_b64encode(hashlib.sha256(secret().encode()).digest())
    return Fernet(derived).encrypt(key.encode()).decode()


def decrypt_api_key(encrypted: str) -> str:
    derived = base64.urlsafe_b64encode(hashlib.sha256(secret().encode()).digest())
    return Fernet(derived).decrypt(encrypted.encode()).decode()


def secret() -> str:
    value = os.getenv("APP_SECRET", "")
    if len(value) < 32:
        raise RuntimeError("APP_SECRET must be set to at least 32 characters")
    return value


def create_token(user_id: int) -> str:
    return jwt.encode({"sub": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(days=1)}, secret(), algorithm="HS256")


def verify_token(token: str) -> int:
    try:
        claims = jwt.decode(token, secret(), algorithms=["HS256"], options={"require": ["sub", "exp"]})
        return int(claims["sub"])
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "Invalid or expired session")


def generate_key() -> str:
    return secrets.token_urlsafe(32)
