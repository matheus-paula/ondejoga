"""Montagem do payload completo do dashboard."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_sessionmaker
from ..schemas import Dashboard, DashboardMeta, SourceMeta
from .cache import cached
from .resolver import (
    build_context,
    enrich_match_logos,
    enrich_standings_logos,
    resolve,
    resolve_broadcasts,
    stats_position_from_standings,
)
from .store import get_config, get_layout

CORE_CAPABILITIES = ("next_match", "last_match", "standings", "news", "stats")


def _fetch_single(
    capability: str, limit: int, user_id: int | None = None
) -> tuple[str, Any, SourceMeta]:
    """Executa uma capacidade em thread própria (sessão própria)."""
    session: Session = get_sessionmaker()()
    try:
        ctx = build_context(session, limit=limit, user_id=user_id)
        data, meta = resolve(session, capability, ctx, update_status=True, user_id=user_id)
        return capability, data, meta
    finally:
        session.close()


def build_dashboard(
    db: Session, *, limit: int = 8, use_cache: bool = True, user_id: int | None = None
) -> Dashboard:
    settings = get_settings()
    ttl = int(settings.get("dashboard_cache_ttl", 60))
    owner = user_id or 0  # 0 = visitante/escopo global

    def _compose() -> Dashboard:
        return _compose_fresh(db, limit=limit, user_id=user_id)

    if use_cache and ttl > 0:
        try:
            dashboard, hit = cached(
                f"dashboard:{owner}", ttl, _compose, allow_stale_on_error=True
            )
            if hit:
                dashboard.meta.cached = True
                return dashboard
        except Exception:  # noqa: BLE001 - sempre devolve algo
            return _compose_fresh(db, limit=limit, user_id=user_id)
    return _compose_fresh(db, limit=limit, user_id=user_id)


def _compose_fresh(db: Session, *, limit: int, user_id: int | None = None) -> Dashboard:
    config = get_config(db, user_id=user_id)
    results: dict[str, Any] = {}
    metas: dict[str, SourceMeta] = {}

    max_workers = min(len(CORE_CAPABILITIES), 6)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_fetch_single, cap, limit, user_id): cap
            for cap in CORE_CAPABILITIES
        }
        for future in as_completed(futures):
            cap = futures[future]
            try:
                capability, data, meta = future.result()
            except Exception as exc:  # noqa: BLE001 - nunca derruba o dashboard
                results[cap] = None
                metas[cap] = SourceMeta(
                    capability=cap, source="—", status="error", error=str(exc)
                )
                continue
            results[capability] = data
            metas[capability] = meta

    # --- enriquecimentos (transmissões, escudos, posição na tabela) -------- #
    ctx = build_context(db, limit=limit, user_id=user_id)
    team_id = ctx.team_id

    # --- jogo ao vivo (widget "Tempo Real") -------------------------------- #
    # Sem jogo em campo não é falha da fonte: por isso fora do loop paralelo e
    # sem fallback offline (o widget simplesmente fica oculto).
    live_match = None
    try:
        live_match, live_meta = resolve(
            db, "live_match", ctx, allow_fallback=False, user_id=user_id
        )
        if live_match is not None:
            enrich_match_logos(live_match, db, ctx)
            metas["live_match"] = live_meta
    except Exception:  # noqa: BLE001
        live_match = None

    next_match = results.get("next_match")
    last_match = results.get("last_match")
    standings = results.get("standings") or []
    stats = results.get("stats")

    for match, cap_name in ((next_match, "next_match"), (last_match, "last_match")):
        if match is None:
            continue
        try:
            broadcasts, meta = resolve_broadcasts(db, ctx, match, user_id=user_id)
        except Exception:  # noqa: BLE001
            broadcasts, meta = [], None
        match.broadcasts = broadcasts
        if meta is not None and broadcasts:
            metas["tv"] = meta
        # garante escudos nos dois lados, mesmo se a fonte não informar
        enrich_match_logos(match, db, ctx)

    if standings:
        try:
            standings = enrich_standings_logos(standings, db, ctx)
        except Exception:  # noqa: BLE001
            pass

    if stats is not None:
        stats = stats_position_from_standings(stats, standings, team_id)

    ordered_metas = [metas[cap] for cap in CORE_CAPABILITIES if cap in metas]
    for extra in ("tv", "live_match"):
        if extra in metas:
            ordered_metas.append(metas[extra])

    return Dashboard(
        team=config.get("team"),
        next_match=next_match,
        last_match=last_match,
        live_match=live_match,
        standings=standings or [],
        news=results.get("news") or [],
        stats=stats,
        meta=DashboardMeta(
            generated_at=datetime.now(timezone.utc),
            cached=False,
            sources=ordered_metas,
        ),
    )


def refresh_interval(db: Session, user_id: int | None = None) -> int:
    try:
        layout = get_layout(db, user_id=user_id)
        return int(layout.get("refresh_interval_seconds") or 300)
    except Exception:  # noqa: BLE001
        return 300
