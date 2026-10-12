"""Contas: registro, login, logout e quem sou eu.

Sessão identificada por cookie httpOnly (`ondejoga_session`); o banco guarda
só o hash do token. Sem login, o app segue funcionando no escopo global.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import current_user_optional
from ..models import User
from ..schemas import AuthStatus, LoginRequest, RegisterRequest, UserOut
from ..services.auth import (
    COOKIE_NAME,
    SESSION_TTL_DAYS,
    AuthError,
    authenticate,
    create_session,
    destroy_session,
    public_user,
    register_user,
)

router = APIRouter(prefix="/api/auth", tags=["contas"])

_COOKIE_PATH = "/api"


def _set_cookie(response: Response, token: str) -> None:
    secure = bool(get_settings().get("cookie_secure"))
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=SESSION_TTL_DAYS * 24 * 3600,
        path=_COOKIE_PATH,
        httponly=True,
        samesite="lax",
        secure=secure,
    )


@router.post("/register", status_code=201)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    try:
        user = register_user(db, payload.username, payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    token = create_session(db, user)
    _set_cookie(response, token)
    return {"user": public_user(user)}


@router.post("/login")
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    try:
        user = authenticate(db, payload.username, payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    token = create_session(db, user)
    _set_cookie(response, token)
    return {"user": public_user(user)}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    destroy_session(db, token)
    response.delete_cookie(key=COOKIE_NAME, path=_COOKIE_PATH, httponly=True)
    return {"ok": True}


@router.get("/me", response_model=AuthStatus)
def me(user: User | None = Depends(current_user_optional)) -> AuthStatus:
    if user is None:
        return AuthStatus(authenticated=False, user=None)
    return AuthStatus(authenticated=True, user=UserOut(**public_user(user)))
