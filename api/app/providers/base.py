"""Base dos provedores de dados (adapters).

Cada `kind` de fonte cadastrada no CRUD tem um adapter responsável por
buscar o dado bruto e convertê-lo para o payload canônico da aplicação.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import get_settings
from ..schemas import (
    Broadcast,
    CompetitionRef,
    Match,
    StandingRow,
    StandingTable,
    TeamRef,
    VenueRef,
)


class ProviderError(Exception):
    """Erro de fonte (rede, resposta inválida, dado ausente)."""


@dataclass
class SourceConfig:
    """Configuração de uma fonte (vinda do banco ou de um teste não salvo)."""

    id: int | str | None
    name: str
    kind: str
    enabled: bool = True
    priority: int = 100
    capabilities: list[str] = field(default_factory=list)
    base_url: str = ""
    api_key: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    endpoints: dict[str, str] = field(default_factory=dict)
    mapping: dict[str, Any] = field(default_factory=dict)
    cache_ttl_seconds: int = 300
    timeout_seconds: int = 8
    notes: str = ""

    @classmethod
    def from_model(cls, obj: Any) -> "SourceConfig":
        return cls(
            id=getattr(obj, "id", None),
            name=obj.name,
            kind=obj.kind,
            enabled=bool(obj.enabled),
            priority=int(obj.priority),
            capabilities=list(obj.capabilities or []),
            base_url=obj.base_url or "",
            api_key=obj.api_key,
            headers=dict(obj.headers or {}),
            endpoints=dict(obj.endpoints or {}),
            mapping=dict(obj.mapping or {}),
            cache_ttl_seconds=int(obj.cache_ttl_seconds or 0),
            timeout_seconds=int(obj.timeout_seconds or 8),
            notes=obj.notes or "",
        )


@dataclass
class ProviderContext:
    """Contexto do time/temporada usado para montar as URLs."""

    team: dict[str, Any] = field(default_factory=dict)
    season: str = ""
    timezone: str = "America/Sao_Paulo"
    locale: str = "pt-BR"
    limit: int = 8
    query: str = ""
    event_id: str | None = None
    competition_ids: list[str] = field(default_factory=list)
    date: str | None = None
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    # Dono dos dados (None = visitante/escopo global) — usado só pelo backend.
    user_id: int | None = None

    @property
    def team_id(self) -> str:
        ids = self.team.get("ids") or {}
        for provider in ("thesportsdb", "espn", "football_data", "api_football"):
            if ids.get(provider):
                return str(ids[provider])
        return str(self.team.get("id") or "")

    def id_for(self, provider: str) -> str:
        ids = self.team.get("ids") or {}
        return str(ids.get(provider) or "")

    @property
    def team_name(self) -> str:
        return str(self.team.get("name") or "")

    @property
    def primary_competition(self) -> str:
        comps = self.competition_ids or self.team.get("competitions") or []
        if not comps:
            return ""
        first = comps[0]
        if isinstance(first, dict):
            return str(first.get("id") or "")
        return str(first)

    @property
    def all_competitions(self) -> list[str]:
        comps = self.competition_ids or self.team.get("competitions") or []
        out: list[str] = []
        for c in comps:
            out.append(str(c.get("id") if isinstance(c, dict) else c))
        return [c for c in out if c]


def build_placeholders(ctx: ProviderContext, source: SourceConfig) -> dict[str, str]:
    ids = ctx.team.get("ids") or {}
    espn_league = str(ids.get("espn_league") or "bra.1")
    wanted = {
        "thesportsdb": "thesportsdb",
        "espn": "espn",
        "football_data": "football_data",
        "api_football": "api_football",
    }.get(source.kind)
    provider_team_id = str(ids.get(wanted) or "") if wanted else ""
    if not provider_team_id:
        provider_team_id = ctx.team_id
    return {
        "api_key": source.api_key or "1",
        "key": source.api_key or "1",
        "team_id": provider_team_id,
        "team_name": ctx.team_name,
        "competition_id": ctx.primary_competition,
        "season": ctx.season or str(ctx.now.year),
        "year": ctx.season or str(ctx.now.year),
        "league": espn_league,
        "espn_league": espn_league,
        "event_id": ctx.event_id or "",
        "limit": str(ctx.limit),
        "query": ctx.query or ctx.team_name,
        "date": ctx.date or ctx.now.strftime("%Y%m%d"),
        "timezone": ctx.timezone,
        "locale": ctx.locale,
    }


class Http:
    """Cliente HTTP pequeno com mensagens de erro consistentes."""

    def __init__(self, source: SourceConfig):
        self.source = source
        settings = get_settings()
        headers = {"User-Agent": settings["user_agent"], "Accept": "*/*"}
        key = source.api_key or ""
        for k, v in (source.headers or {}).items():
            headers[str(k)] = str(v).replace("{api_key}", key).replace("{key}", key)
        self._headers = headers
        self._timeout = source.timeout_seconds or 8

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        if not get_settings()["allow_network"] and not url.startswith(
            ("http://127.", "http://localhost")
        ):
            raise ProviderError("acesso externo desativado (ALLOW_NETWORK=0)")
        try:
            with httpx.Client(
                headers=self._headers,
                timeout=self._timeout,
                follow_redirects=True,
                http2=False,
            ) as client:
                resp = client.request(method, url, **kwargs)
        except httpx.TimeoutException as exc:  # pragma: no cover - rede
            raise ProviderError(f"timeout ao chamar {url}") from exc
        except httpx.HTTPError as exc:  # pragma: no cover - rede
            raise ProviderError(f"falha de rede ao chamar {url}: {exc}") from exc
        if resp.status_code >= 400:
            raise ProviderError(f"HTTP {resp.status_code} em {url}")
        return resp

    def get_json(self, url: str, params: dict | None = None) -> Any:
        resp = self.request("GET", url, params=params)
        try:
            return resp.json()
        except ValueError as exc:
            raise ProviderError(f"resposta não é JSON em {url}") from exc

    def get_text(self, url: str, params: dict | None = None) -> str:
        return self.request("GET", url, params=params).text


class Provider:
    """Adapter base: monta URLs a partir dos endpoints e normaliza."""

    kind = "base"
    DEFAULT_ENDPOINTS: dict[str, str] = {}

    def __init__(self, source: SourceConfig):
        self.source = source
        self.http = Http(source)

    # -- utilidades ------------------------------------------------------- #
    def _endpoint(self, capability: str) -> str:
        return (self.source.endpoints or {}).get(capability) or self.DEFAULT_ENDPOINTS.get(
            capability, ""
        )

    def url(self, capability: str, ctx: ProviderContext, **extra: Any) -> str:
        template = self._endpoint(capability)
        if not template:
            raise ProviderError(f"fonte '{self.source.name}' sem endpoint para '{capability}'")
        values = build_placeholders(ctx, self.source)
        values.update({k: str(v) for k, v in extra.items()})
        try:
            path = template.format(**values)
        except (KeyError, IndexError) as exc:
            raise ProviderError(f"endpoint inválido para '{capability}': {exc}") from exc
        base = self.source.base_url.format(**values)
        return path if path.startswith("http") else base + path

    def fetch_json(self, capability: str, ctx: ProviderContext, **extra: Any) -> Any:
        return self.http.get_json(self.url(capability, ctx, **extra))

    def fetch_text(self, capability: str, ctx: ProviderContext, **extra: Any) -> str:
        return self.http.get_text(self.url(capability, ctx, **extra))

    def team_id(self, ctx: ProviderContext) -> str:
        """Id do time no provedor atual (cada API usa um id diferente)."""
        ids = ctx.team.get("ids") or {}
        return str(ids.get(self.kind) or ctx.team_id)

    # -- contrato --------------------------------------------------------- #
    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# Helpers de normalização
# --------------------------------------------------------------------------- #
def parse_dt(value: Any) -> datetime | None:
    """Interpreta timestamps comuns das fontes (tratados como UTC)."""
    if value in (None, "", 0):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%Y%m%d",
    ):
        try:
            dt = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    try:  # ISO flexível
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def as_int(value: Any, default: int = 0) -> int:
    try:
        if isinstance(value, dict):
            # ESPN devolve {"value": 2.0, "displayValue": "2"}
            for key in ("value", "displayValue", "summary"):
                if key in value and value[key] not in (None, ""):
                    return as_int(value[key], default)
            return default
        if value in (None, ""):
            return default
        if isinstance(value, str):
            value = value.replace("+", "").strip()
            if not value or not re.match(r"^-?\d+(\.\d+)?$", value):
                return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def as_float(value: Any, default: float = 0.0) -> float:
    try:
        if isinstance(value, dict):
            for key in ("value", "displayValue"):
                if key in value and value[key] not in (None, ""):
                    return as_float(value[key], default)
            return default
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def as_str(value: Any, default: str | None = None) -> str | None:
    if value in (None, ""):
        return default
    return str(value)


def competition_ref(
    id_: Any = None,
    name: str = "Competição",
    logo: Any = None,
    kind: str | None = None,
) -> CompetitionRef:
    return CompetitionRef(
        id=as_str(id_),
        name=as_str(name, "Competição") or "Competição",
        logo=as_str(logo),
        kind=kind if kind in ("league", "cup") else None,
    )


def team_ref(id_: Any, name: Any, logo: Any = None, score: Any = None) -> TeamRef:
    score_val = None if score in (None, "") else as_int(score)
    return TeamRef(id=as_str(id_), name=as_str(name, "—") or "—", logo=as_str(logo), score=score_val)


def venue_ref(name: Any = None, city: Any = None) -> VenueRef:
    return VenueRef(name=as_str(name), city=as_str(city))


def table_position(rows: list[StandingRow], team_id: str | None) -> int | None:
    for row in rows:
        if team_id and row.team.id and str(row.team.id) == str(team_id):
            return row.position
    return None


def single_broadcast(name: Any, country: Any = "BR", url: Any = None, logo: Any = None):
    if not name:
        return None
    return Broadcast(
        name=str(name), country=as_str(country), url=as_str(url), logo=as_str(logo)
    )


def elapsed_ms(started: float) -> int:
    return int((time.time() - started) * 1000)


def build_match(
    *,
    id_: Any = None,
    competition: CompetitionRef,
    kickoff: datetime | None,
    home: TeamRef,
    away: TeamRef,
    status: str | None = None,
    round: Any = None,
    venue: VenueRef | None = None,
    finished_at: datetime | None = None,
    broadcasts: list[Broadcast] | None = None,
    source: str | None = None,
) -> Match:
    return Match(
        id=as_str(id_),
        competition=competition,
        kickoff=kickoff,
        finished_at=finished_at,
        status=status,
        round=round,
        home=home,
        away=away,
        venue=venue,
        broadcasts=broadcasts or [],
        source=source,
    )


def make_table(
    *,
    competition: CompetitionRef,
    season: str | None,
    rows: list[StandingRow],
    highlight_team_id: str | None,
    updated_at: datetime | None = None,
) -> StandingTable:
    return StandingTable(
        competition=competition,
        season=season,
        updated_at=updated_at,
        highlight_team_id=highlight_team_id,
        rows=rows,
    )
