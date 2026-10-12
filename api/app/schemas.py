"""Schemas Pydantic: payload canônico + DTOs da API."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Size = Literal["sm", "md", "lg", "full"]
WidgetType = Literal[
    "my_team", "team_header", "next_match", "last_match", "live_match", "standings",
    "news", "stats", "form",
]
SourceKind = Literal[
    "thesportsdb",
    "espn",
    "rss",
    "football_data",
    "api_football",
    "url_json",
    "static_json",
    "wikipedia",
]
Capability = Literal[
    "team", "teams", "standings", "next_match", "last_match", "live_match", "news",
    "stats", "tv", "broadcasts",
]

KNOWN_CAPABILITIES = [
    "team",
    "teams",
    "standings",
    "next_match",
    "last_match",
    "live_match",
    "news",
    "stats",
    "tv",
    "broadcasts",
]


# --------------------------------------------------------------------------- #
# Payload canônico
# --------------------------------------------------------------------------- #
class Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class CompetitionRef(Strict):
    id: str | None = None
    name: str
    logo: str | None = None
    # "league" = pontos corridos · "cup" = mata-mata (fases)
    kind: Literal["league", "cup"] | None = None
    country: str | None = None


class TeamRef(Strict):
    id: str | None = None
    name: str
    logo: str | None = None
    score: int | None = None


class VenueRef(Strict):
    name: str | None = None
    city: str | None = None


class Broadcast(Strict):
    name: str
    country: str | None = None
    url: str | None = None
    logo: str | None = None


class Match(Strict):
    id: str | None = None
    competition: CompetitionRef
    kickoff: datetime | None = None
    finished_at: datetime | None = None
    status: str | None = None
    round: str | int | None = None
    home: TeamRef
    away: TeamRef
    venue: VenueRef | None = None
    broadcasts: list[Broadcast] = Field(default_factory=list)
    source: str | None = None
    # True enquanto o jogo está em andamento (widget "Tempo Real").
    is_live: bool | None = None


class StandingRow(Strict):
    position: int
    team: TeamRef
    played: int = 0
    won: int = 0
    drawn: int = 0
    lost: int = 0
    goals_for: int = 0
    goals_against: int = 0
    goal_difference: int = 0
    points: int = 0
    form: str | None = None
    note: str | None = None


class BracketTie(Strict):
    """Confronto de um mata-mata (chave), ex.: Estudiantes x Universidad Católica.

    `home.score`/`away.score` trazem o **placar agregado** quando já conhecido.
    O vencedor é marcado explicitamente (a Wikipédia destaca o classificado em
    `<b>`, e aqui isso vira `winner`).
    """

    # Rótulo da chave na página ("A", "S1", "F1"...); None quando não há.
    label: str | None = None
    home: TeamRef
    away: TeamRef
    # Placar agregado como texto ("4–1", "1–1 (4–5 p)"); None quando pendente.
    aggregate: str | None = None
    # Resultados por jogo, na ordem ("1–1", "3–0"); pendentes viram "15 out".
    legs: list[str] = Field(default_factory=list)
    penalties: str | None = None
    winner: Literal["home", "away"] | None = None
    # False quando o confronto ainda será disputado.
    decided: bool = False


class StandingTable(Strict):
    competition: CompetitionRef
    season: str | None = None
    updated_at: datetime | None = None
    highlight_team_id: str | None = None
    rows: list[StandingRow] = Field(default_factory=list)
    # Descrição da competição/tabela:
    #  - "group": fase de grupos (label ex.: "Grupo A")
    #  - "stage": fase do mata-mata (ex.: "Oitavas de final")
    kind: Literal["league", "cup"] | None = None
    group: str | None = None
    stage: str | None = None
    # Fase em que o time monitorado está (copas/mata-mata)
    team_stage: str | None = None
    description: str | None = None
    # ---- abas de fase (mata-mata) ---------------------------------------- #
    # Fase a que esta tabela pertence (ex.: "Fase de grupos", "Quartas").
    phase: str | None = None
    # Ordem da fase no torneio (menor = mais antiga); None = pontos corridos.
    phase_order: int | None = None
    # True na tabela da fase atual do time (aba padrão no front).
    is_current: bool = False
    # False quando o time já foi eliminado da competição (None = não sabe).
    team_alive: bool | None = None
    # Confrontos do mata-mata (quando a tabela é de fase eliminatória).
    bracket: list[BracketTie] = Field(default_factory=list)


class NewsItem(Strict):
    id: str
    title: str
    summary: str | None = None
    url: str | None = None
    image: str | None = None
    published_at: datetime | None = None
    source: str | None = None


class FormResult(Strict):
    id: str | None = None
    date: str | None = None
    opponent: str
    result: Literal["W", "D", "L"] | None = None
    score: str | None = None
    venue: Literal["home", "away"] | None = None
    competition: str | None = None


class SeasonLine(Strict):
    competition: str | None = None
    position: int | None = None
    played: int | None = None
    won: int | None = None
    drawn: int | None = None
    lost: int | None = None
    goals_for: int | None = None
    goals_against: int | None = None
    goal_difference: int | None = None
    points: int | None = None
    form: str | None = None


class SplitLine(Strict):
    played: int | None = None
    won: int | None = None
    drawn: int | None = None
    lost: int | None = None
    goals_for: int | None = None
    goals_against: int | None = None


class TopScorer(Strict):
    name: str
    goals: int | None = None
    assists: int | None = None
    matches: int | None = None


class Stats(Strict):
    season: SeasonLine | None = None
    home: SplitLine | None = None
    away: SplitLine | None = None
    goals_scored: int | None = None
    goals_conceded: int | None = None
    clean_sheets: int | None = None
    avg_goals_scored: float | None = None
    avg_goals_conceded: float | None = None
    unbeaten_streak: int | None = None
    win_streak: int | None = None
    goalless_draws: int | None = None
    recent_form: list[FormResult] = Field(default_factory=list)
    top_scorers: list[TopScorer] = Field(default_factory=list)


class SourceMeta(Strict):
    capability: str
    source: str
    status: Literal["ok", "fallback", "error"]
    error: str | None = None


class DashboardMeta(Strict):
    generated_at: datetime
    cached: bool = False
    sources: list[SourceMeta] = Field(default_factory=list)


class Dashboard(Strict):
    team: dict[str, Any] | None = None
    next_match: Match | None = None
    last_match: Match | None = None
    live_match: Match | None = None
    standings: list[StandingTable] = Field(default_factory=list)
    news: list[NewsItem] = Field(default_factory=list)
    stats: Stats | None = None
    meta: DashboardMeta


# --------------------------------------------------------------------------- #
# Configuração
# --------------------------------------------------------------------------- #
class TeamConfig(Strict):
    name: str = "Cruzeiro"
    short_name: str = "Cruzeiro"
    city: str | None = None
    state: str | None = None
    primary_color: str = "#0093EC"
    secondary_color: str = "#FFFFFF"
    logo: str | None = None
    ids: dict[str, str] = Field(default_factory=dict)
    competitions: list[dict[str, Any]] = Field(default_factory=list)


class AppConfig(Strict):
    team: TeamConfig = Field(default_factory=TeamConfig)
    timezone: str = "America/Sao_Paulo"
    locale: str = "pt-BR"
    refresh_interval_seconds: int = 300
    default_theme: Literal["system", "light", "dark"] = "system"


# --------------------------------------------------------------------------- #
# Layout / widgets
# --------------------------------------------------------------------------- #
class WidgetConfig(Strict):
    id: str
    type: WidgetType
    title: str
    visible: bool = True
    order: int = 0
    size: Size = "md"
    options: dict[str, Any] = Field(default_factory=dict)


class ThemeConfig(Strict):
    default: Literal["system", "light", "dark"] = "system"
    accent: str = "#0093EC"


class Layout(Strict):
    theme: ThemeConfig = Field(default_factory=ThemeConfig)
    refresh_interval_seconds: int = 300
    widgets: list[WidgetConfig] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# CRUD de fontes de dados
# --------------------------------------------------------------------------- #
class SourceBase(Strict):
    name: str = Field(min_length=1, max_length=120)
    kind: SourceKind
    enabled: bool = True
    priority: int = Field(default=100, ge=0)
    capabilities: list[Capability] = Field(min_length=1)
    base_url: str = ""
    api_key: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    endpoints: dict[str, str] = Field(default_factory=dict)
    mapping: dict[str, Any] = Field(default_factory=dict)
    cache_ttl_seconds: int = Field(default=300, ge=0)
    timeout_seconds: int = Field(default=8, ge=1, le=60)
    notes: str = ""

    @field_validator("base_url")
    @classmethod
    def _check_url(cls, v: str, info):
        kind = info.data.get("kind")
        if kind == "static_json":
            return v
        if v and not v.startswith(("http://", "https://")):
            raise ValueError("base_url deve começar com http:// ou https://")
        return v

    @field_validator("capabilities")
    @classmethod
    def _check_caps(cls, v: list[str]):
        unknown = [c for c in v if c not in KNOWN_CAPABILITIES]
        if unknown:
            raise ValueError(f"capabilities desconhecidas: {', '.join(unknown)}")
        return v


class SourceCreate(SourceBase):
    pass


class SourceOut(SourceBase):
    id: int
    last_status: str | None = None
    last_error: str | None = None
    last_success_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SourceTestRequest(Strict):
    id: int | None = None
    source: SourceCreate | None = None
    capability: str | None = None


class SourceTestResponse(Strict):
    ok: bool
    status_code: int | None = None
    elapsed_ms: int | None = None
    url: str | None = None
    sample: Any = None
    normalized: Any = None
    error: str | None = None


class CapabilityStatus(Strict):
    capability: str
    active_source: str | None = None
    status: str | None = None
    error: str | None = None
    last_success_at: datetime | None = None
    fallbacks_available: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Autenticação (contas)
# --------------------------------------------------------------------------- #
class RegisterRequest(Strict):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=6, max_length=200)


class LoginRequest(Strict):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)


class UserOut(Strict):
    id: int
    username: str
    team_name: str = ""


class AuthStatus(Strict):
    authenticated: bool
    user: UserOut | None = None


class ProfileUpdate(Strict):
    """Troca de usuário e/ou senha (a senha atual sempre é exigida)."""

    current_password: str = Field(min_length=1, max_length=200)
    username: str | None = Field(default=None, min_length=3, max_length=40)
    new_password: str | None = Field(default=None, min_length=6, max_length=200)


class ResetFileResponse(Strict):
    """Senha temporária gravada em arquivo na raiz do volume do projeto."""

    username: str
    file: str
    path: str
    password: str


# --------------------------------------------------------------------------- #
# Busca/seleção de time (onboarding + troca de time)
# --------------------------------------------------------------------------- #
class TeamCandidate(Strict):
    provider: str
    id: str
    name: str
    short_name: str | None = None
    logo: str | None = None
    country: str | None = None
    league: str | None = None


class SelectTeamRequest(Strict):
    provider: Literal["thesportsdb"] = "thesportsdb"
    id: str = Field(min_length=1, max_length=32)
