from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..schemas import LoginRequest, LoginResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    operator = security.authenticate(payload.username, payload.password)
    if operator is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong operator ID or password")
    token, expires_in = security.issue_token(operator)
    return LoginResponse(
        token=token, expires_in=expires_in, operator=security.public_operator(operator)
    )


@router.get("/me")
def me(operator: dict = Depends(security.current_operator)) -> dict:
    session = db.get_session(operator["id"])
    return {"operator": security.public_operator(operator), "session": session}


@router.get("/demo-accounts")
def demo_accounts() -> list[dict]:
    """Shown on the login screen so a demo never stalls on a forgotten password."""
    return [
        {
            "username": o["username"],
            "password": o["password"],
            "name_en": o["name_en"],
            "name_hi": o["name_hi"],
            "role": o["role"],
        }
        for o in db.OPERATORS
    ]
