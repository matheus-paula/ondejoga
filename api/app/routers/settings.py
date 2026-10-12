"""Configuração da aplicação (time, idioma, tema) e layout dos cards.

Leitura: o usuário vê o que personalizou, herdando o resto do escopo global.
Escrita: exige conta — assim cada usuário tem seu próprio time/config privada.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user_optional
from ..models import User
from ..schemas import AppConfig, Layout, RestoreRequest
from ..services import store
from ..services.auth import verify_password
from ..services.restore import restore

router = APIRouter(prefix="/api", tags=["config"])


def _require_user(user: User | None) -> User:
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="entre ou crie uma conta para salvar configurações",
        )
    return user


@router.get("/config")
def get_config_endpoint(
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    # `owned=false` => o usuário ainda não escolheu o time (portão de onboarding).
    return store.config_payload(db, user_id=user.id if user else None)


@router.put("/config")
def put_config(
    payload: AppConfig,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    user = _require_user(user)
    patch = payload.model_dump(exclude_unset=True)
    try:
        store.save_config(db, patch, user_id=user.id)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    return store.config_payload(db, user_id=user.id)


@router.get("/layout")
def get_layout(
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    try:
        return store.layout_payload(db, user_id=user.id if user else None)
    except ValidationError as exc:
        raise HTTPException(status_code=500, detail=f"layout inválido no banco: {exc}") from exc


@router.put("/layout")
def put_layout(
    payload: Layout,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    user = _require_user(user)
    try:
        store.save_layout(db, payload.model_dump(mode="json"), user_id=user.id)
        return store.layout_payload(db, user_id=user.id)
    except (ValidationError, ValueError) as exc:
        detail = exc.errors() if isinstance(exc, ValidationError) else str(exc)
        raise HTTPException(status_code=422, detail=detail) from exc


@router.post("/layout/reset")
def reset_layout(
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    user = _require_user(user)
    store.reset_layout(db, user_id=user.id)
    return store.layout_payload(db, user_id=user.id)


@router.post("/config/restore")
def restore_settings(
    payload: RestoreRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    """Zera fontes, layout e/ou preferências escolhidas (exige a senha atual).

    Conta, senha e sessão não são mexidas; só o que a pessoa marcou volta ao
    padrão de fábrica.
    """
    user = _require_user(user)
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="senha atual incorreta")
    return restore(db, user, list(payload.items))
