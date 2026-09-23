"""Authentication.

Operator IDs and a shared demo password, signed into a JWT. Deliberately simple:
the interesting part of this project is what happens after login, and a site
deployment would swap this for the customer's identity provider.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db
from .config import settings

_scheme = HTTPBearer(auto_error=False)


def authenticate(username: str, password: str) -> dict | None:
    operator = next(
        (o for o in db.OPERATORS if o["username"].lower() == (username or "").strip().lower()), None
    )
    if operator is None or operator["password"] != password:
        return None
    return operator


def issue_token(operator: dict) -> tuple[str, int]:
    expires_in = settings.jwt_ttl_minutes * 60
    payload = {
        "sub": operator["id"],
        "role": operator["role"],
        "name": operator["name_en"],
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_ttl_minutes),
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_in


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please sign in again")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


def current_operator(
    credentials: HTTPAuthorizationCredentials | None = Depends(_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(credentials.credentials)
    operator = db.operator(payload.get("sub", ""))
    if operator is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown operator")
    return operator


def public_operator(operator: dict) -> dict:
    """Operator record without the password field."""
    return {k: v for k, v in operator.items() if k != "password"}


def current_manager(operator: dict = Depends(current_operator)) -> dict:
    """Only a manager may assign, change or remove other people's work."""
    if operator.get("role") != "manager":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Managers only")
    return operator
