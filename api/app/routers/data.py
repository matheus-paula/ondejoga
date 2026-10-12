"""Endpoints de leitura do dashboard."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import APP_VERSION
from ..db import get_db
from ..deps import current_user_optional
from ..models import User
from ..schemas import Match, NewsItem, Stats
from ..services.dashboard import build_dashboard
from ..services.resolver import (
    build_context,
    enrich_match_logos,
    enrich_standings_logos,
    resolve,
    resolve_broadcasts,
    stats_position_from_standings,
)

router = APIRouter(prefix="/api", tags=["dados"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
        database = "up"
    except Exception as exc:  # noqa: BLE001
        database = f"down: {exc}"
    return {"status": "ok" if database == "up" else "degraded", "database": database,
            "version": APP_VERSION}


@router.get("/dashboard")
def dashboard(limit: int = Query(default=8, ge=1, le=30),
              refresh: bool = False,
              db: Session = Depends(get_db),
              user: User | None = Depends(current_user_optional)) -> dict:
    payload = build_dashboard(
        db, limit=limit, use_cache=not refresh, user_id=user.id if user else None
    )
    return payload.model_dump(mode="json")


def _section(capability: str, db: Session, *, limit: int = 8, enrich: str | None = None,
             user: User | None = None):
    owner = user.id if user else None
    ctx = build_context(db, limit=limit, user_id=owner)
    data, meta = resolve(db, capability, ctx, update_status=True, user_id=owner)
    if enrich == "broadcasts" and data is not None:
        broadcasts, tv_meta = resolve_broadcasts(db, ctx, data, user_id=owner)
        data.broadcasts = broadcasts
        if tv_meta is not None:
            meta = tv_meta if meta.status != "ok" else meta
        enrich_match_logos(data, db, ctx)
    if enrich == "logos" and data:
        data = enrich_standings_logos(data, db, ctx)
    if enrich == "position" and data is not None:
        tables, _ = resolve(db, "standings", ctx, update_status=False, user_id=owner)
        data = stats_position_from_standings(data, tables or [], ctx.team_id)
    return data, meta


@router.get("/next-match")
def next_match(db: Session = Depends(get_db),
               user: User | None = Depends(current_user_optional)) -> Match | None:
    data, _ = _section("next_match", db, enrich="broadcasts", user=user)
    if data is None:
        raise HTTPException(status_code=404, detail="nenhum próximo jogo disponível")
    return data


@router.get("/last-match")
def last_match(db: Session = Depends(get_db),
               user: User | None = Depends(current_user_optional)) -> Match | None:
    data, _ = _section("last_match", db, enrich="broadcasts", user=user)
    if data is None:
        raise HTTPException(status_code=404, detail="nenhum último jogo disponível")
    return data


@router.get("/live-match")
def live_match(db: Session = Depends(get_db),
               user: User | None = Depends(current_user_optional)) -> Match | None:
    """Jogo do time em andamento agora; `null` quando não está jogando."""
    owner = user.id if user else None
    ctx = build_context(db, limit=1, user_id=owner)
    data, _meta = resolve(db, "live_match", ctx, allow_fallback=False, user_id=owner)
    if data is not None:
        enrich_match_logos(data, db, ctx)
    return data


@router.get("/standings")
def standings(db: Session = Depends(get_db),
              user: User | None = Depends(current_user_optional)) -> list:
    data, _ = _section("standings", db, enrich="logos", user=user)
    return data or []


@router.get("/news")
def news(limit: int = Query(default=8, ge=1, le=30),
         db: Session = Depends(get_db),
         user: User | None = Depends(current_user_optional)) -> list[NewsItem]:
    data, _ = _section("news", db, limit=limit, user=user)
    return data or []


@router.get("/stats")
def stats(db: Session = Depends(get_db),
          user: User | None = Depends(current_user_optional)) -> Stats:
    data, _ = _section("stats", db, enrich="position", user=user)
    if data is None:
        raise HTTPException(status_code=404, detail="estatísticas indisponíveis")
    return data
