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
from ..schemas import AuthStatus, LoginRequest, ProfileUpdate, RegisterRequest, ResetFileResponse, UserOut
from ..services.auth import (
    COOKIE_NAME,
    SESSION_TTL_DAYS,
    AuthError,
    authenticate,
    change_username,
    create_session,
    destroy_other_sessions,
    destroy_session,
    public_user,
    register_user,
    set_password,
    temporary_password,
    verify_password,
    write_reset_file,
)

router = APIRouter(prefix="/api/auth", tags=["contas"])

_COOKIE_PATH = "/api"


def _require_user(user: User | None) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="entre ou crie uma conta primeiro")
    return user


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


def _session_payload(user: User, token: str) -> dict:
    """Resposta de login/registro com o token também no corpo.

    O cookie `SameSite=Lax` morre dentro de um iframe de outro site (ex.:
    OndeJoga embutido no Home Assistant) — o navegador não o envia em
    requisições cross-site. Como não dá para usar `None; Secure` sem HTTPS,
    o mesmo token via `Authorization: Bearer` é a reserva que segura a
    sessão nesse arranjo. `deps._token_from` já aceita os dois.
    """
    return {"user": public_user(user), "token": token}


@router.post("/register", status_code=201)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    try:
        user = register_user(db, payload.username, payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    token = create_session(db, user)
    _set_cookie(response, token)
    return _session_payload(user, token)


@router.post("/login")
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    try:
        user = authenticate(db, payload.username, payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    token = create_session(db, user)
    _set_cookie(response, token)
    return _session_payload(user, token)


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


@router.put("/profile")
def update_profile(
    payload: ProfileUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    """Troca usuário e/ou senha; a senha atual sempre é exigida."""
    user = _require_user(user)
    if not (payload.username or payload.new_password):
        raise HTTPException(status_code=400, detail="informe um novo usuário ou uma nova senha")
    password_changed = False
    try:
        if not verify_password(payload.current_password, user.password_hash):
            raise AuthError("senha atual incorreta", 401)
        if payload.username is not None and payload.username != user.username:
            change_username(db, user, payload.username)
        if payload.new_password:
            set_password(db, user, payload.new_password)
            password_changed = True
    except AuthError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    if password_changed:
        # Troca de senha derruba as outras sessões (a atual continua valendo).
        destroy_other_sessions(db, user.id, keep_token=request.cookies.get(COOKIE_NAME))
    return {"user": public_user(user)}


@router.post("/reset-file", response_model=ResetFileResponse)
def reset_via_file(
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> ResetFileResponse:
    """Gera senha temporária e a grava em `RESET-<usuario>.txt` na raiz do volume.

    Fluxo de autoatendimento: o dono do container lê o arquivo, entra com a
    senha temporária e troca a senha de verdade em Configurações → Conta.
    O arquivo é gravado antes da troca — se a gravação falhar, a conta segue
    acessível com a senha atual.
    """
    user = _require_user(user)
    password = temporary_password()
    path = write_reset_file(user, password)
    set_password(db, user, password)
    destroy_other_sessions(db, user.id, keep_token=request.cookies.get(COOKIE_NAME))
    return ResetFileResponse(
        username=user.username, file=path.name, path=str(path), password=password
    )
