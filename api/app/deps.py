"""Dependências FastAPI compartilhadas: usuário logado (ou anônimo)."""
from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .services.auth import COOKIE_NAME, user_for_token


def _token_from(request: Request) -> str | None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        return token
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def current_user_optional(
    request: Request, db: Session = Depends(get_db)
) -> User | None:
    """Usuário da sessão atual, ou `None` para visitante anônimo.

    Anônimos operam no escopo global (padrões do app) — o comportamento de
    sempre. Logados, cada um enxerga/edita só o próprio time e layout.
    """
    return user_for_token(db, _token_from(request))
