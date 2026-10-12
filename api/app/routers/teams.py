"""Busca e seleção de times (onboarding + troca de time em Configurações)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user_optional
from ..models import User
from ..schemas import SelectTeamRequest, TeamCandidate
from ..services import store, teams
from ..services.teams import TeamsError

router = APIRouter(prefix="/api", tags=["times"])


def _require_user(user: User | None) -> User:
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="entre ou crie uma conta para escolher o time",
        )
    return user


@router.get("/teams/search")
def search_teams(
    q: str = Query(..., min_length=2, max_length=60),
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    """Sugere times (somente futebol) para o onboarding e a troca de time."""
    try:
        results = teams.search_teams(db, q, user_id=user.id if user else None)
    except TeamsError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    return {"query": q.strip(), "results": [TeamCandidate(**r).model_dump() for r in results]}


@router.post("/config/team")
def select_team(
    payload: SelectTeamRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    """Escolhe o time do usuário: salva a config particular dele e limpa cache."""
    user = _require_user(user)
    try:
        teams.set_user_team(db, user, payload.provider, payload.id)
    except TeamsError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    return store.config_payload(db, user_id=user.id)
