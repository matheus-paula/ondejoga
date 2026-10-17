"""Montagem do payload completo do dashboard."""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_sessionmaker
from ..schemas import Dashboard, DashboardMeta, SourceMeta
from .cache import cache
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


def _fetch_live(limit: int, user_id: int | None = None):
    """Jogo em campo, em thread própria. Sem fallback: sem jogo é estado normal."""
    session: Session = get_sessionmaker()()
    try:
        ctx = build_context(session, limit=limit, user_id=user_id)
        return resolve(session, "live_match", ctx, allow_fallback=False, user_id=user_id)
    finally:
        session.close()


def _fetch_broadcasts(match: Any, limit: int, user_id: int | None = None):
    """Transmissões de um jogo, em thread própria (sessão própria)."""
    session: Session = get_sessionmaker()()
    try:
        ctx = build_context(session, limit=limit, user_id=user_id)
        return resolve_broadcasts(session, ctx, match, user_id=user_id)
    finally:
        session.close()


def _age_seconds(dashboard: Dashboard) -> float:
    """Idade do payload, em segundos (infinito quando a data não veio)."""
    generated = dashboard.meta.generated_at
    if generated is None:
        return float("inf")
    if generated.tzinfo is None:
        generated = generated.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - generated).total_seconds()


# Chaves já sendo recompõidas em segundo plano. Sem isto, uma aba que
# recarrega várias vezes dispararia vários refrescos do mesmo payload.
_REFRESHING: set[str] = set()
_REFRESHING_LOCK = threading.Lock()


def _recompose_in_background(key: str, ttl: float, limit: int, user_id: int | None) -> None:
    """Recompõe o dashboard em thread própria, sem segurar a resposta.

    A sessão não pode ser a da requisição — ela volta ao pool ao fim do
    request — então cada trabalho abre a sua, como já faz o `_fetch_single`.
    """
    with _REFRESHING_LOCK:
        if key in _REFRESHING:
            return
        _REFRESHING.add(key)

    def _job() -> None:
        session: Session = get_sessionmaker()()
        try:
            cache.set(key, _compose_fresh(session, limit=limit, user_id=user_id), ttl)
        except Exception:  # noqa: BLE001 - em segundo plano, nunca derruba
            pass
        finally:
            session.close()
            with _REFRESHING_LOCK:
                _REFRESHING.discard(key)

    threading.Thread(target=_job, name="dashboard-refresh", daemon=True).start()


def build_dashboard(
    db: Session, *, limit: int = 8, use_cache: bool = True, user_id: int | None = None
) -> Dashboard:
    settings = get_settings()
    ttl = int(settings.get("dashboard_cache_ttl", 60))
    owner = user_id or 0  # 0 = visitante/escopo global

    if use_cache and ttl > 0:
        key = f"dashboard:{owner}"

        hit = cache.get(key)
        if hit is not None:
            hit.meta.cached = True
            return hit

        # Dado expirado mas ainda servível: entrega na hora e refaz o payload
        # em segundo plano. Compor o dashboard é uma volta à rede por
        # capacidade (a Wikipedia sozinha leva ~3s) e a tela não precisa
        # esperar por um dado que já está aqui.
        stale = cache.get(key, allow_stale=True)
        if stale is not None and _age_seconds(stale) <= settings["dashboard_stale_seconds"]:
            _recompose_in_background(key, ttl, limit, user_id)
            stale.meta.cached = True
            return stale

        try:
            value = _compose_fresh(db, limit=limit, user_id=user_id)
        except Exception:  # noqa: BLE001 - se dá para compor, devolve algo
            if stale is not None:
                stale.meta.cached = True
                return stale
            raise

        cache.set(key, value, ttl)
        return value

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

    # --- jogo ao vivo + transmissões dos dois jogos, em paralelo ----------- #
    # Isto era feito em série, uma chamada atrás da outra: três idas e voltas
    # de rede que somavam o grosso do tempo do dashboard (a tela só aparecia
    # quando a última voltava). Cada tarefa tem a sua thread e a sua sessão.
    next_match = results.get("next_match")
    last_match = results.get("last_match")
    standings = results.get("standings") or []
    stats = results.get("stats")

    matches = {
        cap: match
        for match, cap in ((next_match, "next_match"), (last_match, "last_match"))
        if match is not None
    }
    live_match = None

    with ThreadPoolExecutor(max_workers=1 + len(matches)) as pool:
        futures = {pool.submit(_fetch_live, limit, user_id): "live_match"}
        for cap, match in matches.items():
            futures[pool.submit(_fetch_broadcasts, match, limit, user_id)] = cap

        for future in as_completed(futures):
            cap = futures[future]
            try:
                result = future.result()
            except Exception:  # noqa: BLE001 - nunca derruba o dashboard
                continue
            if cap == "live_match":
                live_match, live_meta = result
                if live_match is not None:
                    metas["live_match"] = live_meta
                continue
            broadcasts, meta = result
            match = matches[cap]
            match.broadcasts = broadcasts
            if meta is not None and broadcasts:
                metas["tv"] = meta

    # Os escudos são preenchidos aqui em cima: mexem na sessão principal.
    for match in [live_match, *matches.values()]:
        if match is None:
            continue
        try:
            enrich_match_logos(match, db, ctx)
        except Exception:  # noqa: BLE001 - escudo faltando não é erro fatal
            pass

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
