"""Resolvedor: escolhe a fonte disponível, com cache, fallback e status."""
from __future__ import annotations

import re
import threading
import unicodedata
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import ApiSource
from ..providers import ProviderContext, ProviderError, SourceConfig, build_provider
from ..schemas import Broadcast, SourceMeta, StandingTable, Stats
from .cache import cache, cached
from .fallback import load_fallback
from .store import get_config

EMPTY_CAPABILITIES = {"team", "teams", "standings", "next_match", "last_match",
                      "live_match", "news", "stats", "tv", "broadcasts"}

# Capacidades "ao vivo": TTL curto e ausência de dado é estado normal
# (nenhum jogo em andamento), não uma falha da fonte.
LIVE_CAPABILITIES = {"live_match"}
LIVE_TTL_SECONDS = 15

_RUNTIME_STATUS: dict[str, dict] = {}
_RUNTIME_LOCK = threading.Lock()


def build_context(
    db: Session,
    *,
    limit: int = 8,
    event_id: str | None = None,
    date: str | None = None,
    now: datetime | None = None,
    user_id: int | None = None,
) -> ProviderContext:
    config = get_config(db, user_id=user_id)
    team = config.get("team") or {}
    moment = now or datetime.now(timezone.utc)
    competitions = team.get("competitions") or []
    return ProviderContext(
        team=team,
        season=str(moment.year),
        timezone=config.get("timezone") or "America/Sao_Paulo",
        locale=config.get("locale") or "pt-BR",
        limit=limit,
        event_id=event_id,
        date=date,
        competition_ids=[str(c.get("id")) for c in competitions if isinstance(c, dict) and c.get("id")],
        now=moment,
        user_id=user_id,
    )


def sources_for(
    db: Session, capability: str, user_id: int | None = None
) -> list[SourceConfig]:
    rows = db.scalars(
        select(ApiSource)
        .where(ApiSource.enabled.is_(True), ApiSource.owner_filter(user_id))
        .order_by(ApiSource.priority.asc(), ApiSource.id.asc())
    ).all()
    out = []
    for row in rows:
        caps = row.capabilities or []
        if capability in caps:
            out.append(SourceConfig.from_model(row))
    return out


def _cache_key(source: SourceConfig, capability: str, ctx: ProviderContext) -> str:
    return cache.make_key(
        "cap",
        source.id,
        source.kind,
        capability,
        ctx.team_id,
        ctx.season,
        ctx.event_id or "",
        ",".join(ctx.all_competitions),
        ctx.limit if capability in ("news",) else "",
        ctx.date or "",
    )


def is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, (list, tuple, str, dict)):
        return len(value) == 0
    if isinstance(value, Stats):
        has_data = bool(
            value.season
            or value.recent_form
            or value.home
            or value.away
            or value.top_scorers
            or value.goals_scored is not None
        )
        return not has_data
    return False


def _record_status(
    db: Session,
    source_id: int | str | None,
    capability: str,
    status: str,
    error: str | None,
) -> None:
    if source_id is None or not isinstance(source_id, int):
        return
    with _RUNTIME_LOCK:
        _RUNTIME_STATUS[f"{source_id}|{capability}"] = {
            "status": status,
            "error": error,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    row = db.get(ApiSource, source_id)
    if row is None:
        return
    if row.last_status == status and (row.last_error or None) == (error or None):
        return
    row.last_status = status
    row.last_error = error
    if status == "ok":
        from ..models import utcnow

        row.last_success_at = utcnow()
    db.commit()


def runtime_status(source_id: int | str | None, capability: str) -> dict | None:
    """Status em memória da última tentativa de uma capacidade em uma fonte."""
    if source_id is None:
        return None
    with _RUNTIME_LOCK:
        entry = _RUNTIME_STATUS.get(f"{source_id}|{capability}")
    return dict(entry) if entry else None


def clear_runtime_status() -> None:
    with _RUNTIME_LOCK:
        _RUNTIME_STATUS.clear()


def resolve(
    db: Session,
    capability: str,
    ctx: ProviderContext,
    *,
    allow_fallback: bool = True,
    update_status: bool = True,
    user_id: int | None = None,
) -> tuple[Any, SourceMeta]:
    """Tenta cada fonte habilitada por prioridade; se falhar, usa o backup."""
    owner = user_id if user_id is not None else getattr(ctx, "user_id", None)
    sources = sources_for(db, capability, owner)
    last_error: str | None = None

    if not sources:
        last_error = "nenhuma fonte habilitada para esta informação"
    for source in sources:
        if not source.base_url and source.kind != "static_json":
            last_error = f"{source.name}: base_url vazia"
            if update_status:
                _record_status(db, source.id, capability, "error", "base_url vazia")
            continue
        try:
            provider = build_provider(source)
        except ProviderError as exc:
            last_error = f"{source.name}: {exc}"
            if update_status:
                _record_status(db, source.id, capability, "error", str(exc))
            continue
        key = _cache_key(source, capability, ctx)
        ttl = source.cache_ttl_seconds or get_settings()["default_cache_ttl"]
        if capability in LIVE_CAPABILITIES:
            ttl = min(ttl, LIVE_TTL_SECONDS)  # placar ao vivo não pode ficar velho
        try:
            value, _hit = cached(key, ttl, lambda p=provider: p.fetch(capability, ctx))
        except ProviderError as exc:
            last_error = f"{source.name}: {exc}"
            if update_status:
                _record_status(db, source.id, capability, "error", str(exc))
            continue
        except Exception as exc:  # noqa: BLE001 - qualquer falha passa para a próxima fonte
            last_error = f"{source.name}: {type(exc).__name__}: {exc}"
            if update_status:
                _record_status(db, source.id, capability, "error", str(exc))
            continue
        if is_empty(value):
            if capability in LIVE_CAPABILITIES:
                # "nenhum jogo em campo agora" é um resultado válido
                if update_status:
                    _record_status(db, source.id, capability, "ok", None)
                return None, SourceMeta(
                    capability=capability, source=source.name, status="ok"
                )
            last_error = f"{source.name}: sem dados"
            if update_status:
                _record_status(db, source.id, capability, "error", "sem dados")
            continue
        if update_status:
            _record_status(db, source.id, capability, "ok", None)
        return value, SourceMeta(capability=capability, source=source.name, status="ok")

    if allow_fallback:
        backup = load_fallback(capability, ctx)
        if not is_empty(backup):
            return backup, SourceMeta(
                capability=capability,
                source="backup local",
                status="fallback",
                error=last_error,
            )
    return None, SourceMeta(
        capability=capability, source="—", status="error", error=last_error
    )


def _match_date(ctx: ProviderContext, match: Any) -> str | None:
    """Data do jogo em `YYYYMMDD` no fuso configurado (fallback: hoje)."""
    kickoff = getattr(match, "kickoff", None) or getattr(match, "finished_at", None)
    if kickoff is None:
        return None
    try:
        from zoneinfo import ZoneInfo

        if kickoff.tzinfo is None:
            kickoff = kickoff.replace(tzinfo=timezone.utc)
        local = kickoff.astimezone(ZoneInfo(ctx.timezone or "America/Sao_Paulo"))
        return local.strftime("%Y%m%d")
    except Exception:  # noqa: BLE001 - fuso inválido não pode quebrar a busca
        return kickoff.astimezone(timezone.utc).strftime("%Y%m%d")


def resolve_broadcasts(
    db: Session, ctx: ProviderContext, match: Any, *, user_id: int | None = None
) -> tuple[list[Broadcast], SourceMeta | None]:
    if match is None:
        return [], None
    # O placar da ESPN é por dia: consultamos a data do jogo (no fuso configurado)
    # em vez de "hoje", senão jogos de outros dias ficam invisíveis.
    ctx_event = replace(ctx, event_id=match.id or ctx.event_id, date=_match_date(ctx, match))
    collected: list[Broadcast] = []
    meta: SourceMeta | None = None
    for capability in ("tv", "broadcasts"):
        data, cap_meta = resolve(
            db, capability, ctx_event, allow_fallback=not collected, user_id=user_id
        )
        if is_empty(data):
            continue
        meta = cap_meta
        for item in data if isinstance(data, list) else [data]:
            if isinstance(item, Broadcast):
                collected.append(item)
    seen: set[str] = set()
    unique = []
    for b in collected:
        if b.name in seen:
            continue
        seen.add(b.name)
        unique.append(b)
    return unique, meta


# --------------------------------------------------------------------------- #
# Enriquecimento das tabelas com escudos
# --------------------------------------------------------------------------- #
def normalize_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\b(fc|sc|cr|clube|saf|e\s*|futebol)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _logo_map(
    db: Session, ctx: ProviderContext, user_id: int | None = None
) -> dict[str, str]:
    owner = user_id if user_id is not None else getattr(ctx, "user_id", None)
    sources = sources_for(db, "teams", owner)
    if not sources:
        return {}
    key = cache.make_key("logos", ctx.season, ctx.team_name, owner or "")
    cached_map = cache.get(key)
    if cached_map is not None:
        return cached_map
    mapping: dict[str, str] = {}
    active_id = None
    for source in sources:
        active_id = source.id
        try:
            provider = build_provider(source)
            teams = provider.fetch("teams", ctx)
        except Exception as exc:  # noqa: BLE001 - enriquecimento é opcional
            _record_status(db, source.id, "teams", "error", str(exc))
            continue
        for team in teams or []:
            name = normalize_name(team.get("name") or "")
            logo = team.get("logo")
            if name and logo:
                mapping.setdefault(name, logo)
                mapping.setdefault(normalize_name(team.get("short_name") or ""), logo)
        if mapping:
            _record_status(db, source.id, "teams", "ok", None)
            break
        _record_status(db, source.id, "teams", "error", "sem escudos retornados")
    if mapping:
        cache.set(key, mapping, 60 * 60 * 12)
    return mapping


def enrich_match_logos(match: Any, db: Session, ctx: ProviderContext) -> Any:
    """Garante escudo nos dois lados do jogo (fallback pelo nome normalizado).

    A TheSportsDB já devolve os badges; se alguma fonte não informar, busca no
    mapa de escudos usado também pelas tabelas — assim os cartões de próximo e
    último jogo sempre mostram as armas.
    """
    if match is None:
        return match
    try:
        logos = _logo_map(db, ctx)
    except Exception:  # noqa: BLE001 - enriquecimento é opcional
        return match
    if not logos:
        return match
    keys = [k for k in logos if k]
    own_name = normalize_name(ctx.team_name)
    own_logo = ctx.team.get("logo")
    for side in ("home", "away"):
        team = getattr(match, side, None)
        if team is None or team.logo:
            continue
        name = normalize_name(team.name or "")
        if own_logo and name and name == own_name:
            team.logo = own_logo
            continue
        logo = logos.get(name)
        if not logo and name:
            first_word = name.split(" ")[0]
            candidates = [k for k in keys if k.startswith(first_word)]
            if len(candidates) == 1:
                logo = logos[candidates[0]]
        if logo:
            team.logo = logo
    return match


def enrich_standings_logos(
    tables: list[StandingTable], db: Session, ctx: ProviderContext
) -> list[StandingTable]:
    if not tables:
        return tables
    try:
        logos = _logo_map(db, ctx)
    except Exception:  # noqa: BLE001
        logos = {}
    own_name = normalize_name(ctx.team_name)
    own_logo = ctx.team.get("logo")
    keys = [k for k in logos if k]

    def fill(team: Any) -> None:
        """Completa id+escudo de um time a partir do nome normalizado."""
        normalized = normalize_name(team.name)
        if own_name and normalized == own_name:
            # garante id+escudo do nosso time (fontes como Wikipédia não trazem ids)
            team.id = team.id or ctx.team_id
            team.logo = team.logo or own_logo
        if team.logo:
            return
        logo = logos.get(normalized)
        if not logo and normalized:
            first_word = normalized.split(" ")[0]
            candidates = [k for k in keys if k.startswith(first_word)]
            if len(candidates) == 1:
                logo = logos[candidates[0]]
        if logo:
            team.logo = logo

    for table in tables:
        for row in table.rows:
            fill(row.team)
        # Mata-mata: escudos também nos confrontos das chaves.
        for tie in table.bracket:
            fill(tie.home)
            fill(tie.away)
    return tables


def stats_position_from_standings(stats: Stats | None, tables: list[StandingTable],
                                  team_id: str | None) -> Stats | None:
    """Completa posição/pontos da estatística quando a fonte não informou."""
    if stats is None or not tables:
        return stats
    for table in tables:
        for row in table.rows:
            if team_id and row.team.id and str(row.team.id) == str(team_id):
                if stats.season is None:
                    from ..schemas import SeasonLine

                    stats.season = SeasonLine(
                        competition=table.competition.name,
                        position=row.position,
                        played=row.played,
                        won=row.won,
                        drawn=row.drawn,
                        lost=row.lost,
                        goals_for=row.goals_for,
                        goals_against=row.goals_against,
                        goal_difference=row.goal_difference,
                        points=row.points,
                        form=row.form,
                    )
                else:
                    if stats.season.position is None:
                        stats.season.position = row.position
                    if stats.season.points is None:
                        stats.season.points = row.points
                    if stats.season.competition is None:
                        stats.season.competition = table.competition.name
                return stats
    return stats
