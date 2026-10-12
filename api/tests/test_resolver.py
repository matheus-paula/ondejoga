"""Testes do resolvedor: prioridade, cache, fallback, status e enriquecimentos."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.models import ApiSource
from app.providers import PROVIDERS, Provider, SourceConfig
from app.providers.base import ProviderContext, ProviderError
from app.providers.mapping import record_to_broadcasts, records_to_news
from app.schemas import (
    BracketTie,
    CompetitionRef,
    SeasonLine,
    StandingRow,
    StandingTable,
    Stats,
    TeamRef,
)
from app.services.cache import cache
from app.services.fallback import DATA_FILE
from app.services.resolver import (
    build_context,
    clear_runtime_status,
    enrich_standings_logos,
    is_empty,
    normalize_name,
    resolve,
    resolve_broadcasts,
    runtime_status,
    sources_for,
    stats_position_from_standings,
)


class FakeProvider(Provider):
    """Provedor de teste: devolve o payload canônico de `mapping[capability]`."""

    kind = "fake"
    calls: list[str] = []

    def fetch(self, capability: str, ctx: ProviderContext):
        payload = (self.source.mapping or {}).get(capability)
        FakeProvider.calls.append(f"{self.source.name}:{capability}")
        if isinstance(payload, dict) and payload.get("error"):
            raise ProviderError(str(payload["error"]))
        if capability == "news":
            return records_to_news(payload or [], self.source.name)
        if capability in ("tv", "broadcasts"):
            return record_to_broadcasts(payload or [])
        return payload


@pytest.fixture()
def fake_kind(monkeypatch):
    FakeProvider.calls = []
    monkeypatch.setitem(PROVIDERS, "fake", FakeProvider)
    return FakeProvider


def _add_source(db, name: str, *, priority: int = 10, capabilities=("news",),
                mapping=None, enabled: bool = True, kind: str = "fake",
                base_url: str = "https://fake.test/") -> int:
    row = ApiSource(
        name=name,
        kind=kind,
        enabled=enabled,
        priority=priority,
        capabilities=list(capabilities),
        base_url=base_url,
        mapping=mapping or {},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id


def _ctx(db) -> ProviderContext:
    return build_context(db)


# --------------------------------------------------------------------------- #
# Seleção por prioridade
# --------------------------------------------------------------------------- #
def test_sources_are_ordered_by_priority(db) -> None:
    _add_source(db, "Secundária", priority=20)
    _add_source(db, "Primária", priority=10)
    _add_source(db, "Desligada", priority=5, enabled=False)
    _add_source(db, "Outra capacidade", priority=1, capabilities=["stats"])

    names = [s.name for s in sources_for(db, "news")]
    assert names == ["Primária", "Secundária"]


def test_resolve_uses_highest_priority_source(db, fake_kind) -> None:
    _add_source(db, "Primária", priority=10, mapping={"news": [{"title": "A"}]})
    _add_source(db, "Secundária", priority=20, mapping={"news": [{"title": "B"}]})

    value, meta = resolve(db, "news", _ctx(db))

    assert [n.title for n in value] == ["A"]
    assert meta.source == "Primária"
    assert meta.status == "ok"
    primary = db.query(ApiSource).filter(ApiSource.name == "Primária").one()
    assert runtime_status(primary.id, "news")["status"] == "ok"
    assert FakeProvider.calls == ["Primária:news"]


def test_resolve_falls_back_to_next_source_on_error(db, fake_kind) -> None:
    _add_source(db, "Primária", priority=10, mapping={"news": {"error": "API morta"}})
    secondary = _add_source(db, "Secundária", priority=20, mapping={"news": [{"title": "B"}]})

    value, meta = resolve(db, "news", _ctx(db))

    assert [n.title for n in value] == ["B"]
    assert meta.source == "Secundária"
    assert runtime_status(secondary, "news")["status"] == "ok"
    errored = db.query(ApiSource).filter(ApiSource.name == "Primária").one()
    assert errored.last_status == "error"
    assert "API morta" in (errored.last_error or "")


def test_resolve_ignores_disabled_sources(db, fake_kind) -> None:
    _add_source(db, "Desligada", enabled=False, mapping={"news": [{"title": "X"}]})
    value, meta = resolve(db, "news", _ctx(db), allow_fallback=False)
    assert value is None
    assert meta.status == "error"
    assert "nenhuma fonte" in (meta.error or "")


def test_resolve_uses_backup_when_everything_fails(db, fake_kind) -> None:
    if not DATA_FILE.exists():  # fallback.json é gerado por scripts/generate_fallback.py
        pytest.skip("app/data/fallback.json não gerado")
    _add_source(db, "Quebrada", mapping={"news": {"error": "HTTP 500"}})

    value, meta = resolve(db, "news", _ctx(db))

    assert meta.status == "fallback"
    assert meta.source == "backup local"
    assert value  # notícias de backup presentes


def test_resolve_without_backup_returns_error(db, fake_kind) -> None:
    _add_source(db, "Quebrada", mapping={"stats": {"error": "HTTP 500"}})
    value, meta = resolve(db, "stats", _ctx(db), allow_fallback=False)
    assert value is None
    assert meta.status == "error"


def test_resolve_rejects_source_without_base_url(db, fake_kind) -> None:
    _add_source(db, "Sem URL", kind="espn", base_url="", capabilities=["stats"])
    value, meta = resolve(db, "stats", _ctx(db), allow_fallback=False)
    assert value is None
    assert "base_url vazia" in (meta.error or "")


def test_resolve_caches_per_source_and_capability(db, fake_kind) -> None:
    _add_source(db, "Única", capabilities=("news", "stats"),
                mapping={"news": [{"title": "A"}], "stats": Stats().model_dump()})
    ctx = _ctx(db)

    first, _ = resolve(db, "news", ctx)
    second, _ = resolve(db, "news", ctx)
    assert fake_kind.calls.count("Única:news") == 1
    assert first == second

    resolve(db, "stats", ctx)  # capacidade distinta => nova chamada
    assert fake_kind.calls == ["Única:news", "Única:stats"]


# --------------------------------------------------------------------------- #
# Enriquecimentos
# --------------------------------------------------------------------------- #
def _table(*names: str) -> list[StandingTable]:
    rows = [
        StandingRow(position=i, team=TeamRef(id=None, name=name), points=30 - i)
        for i, name in enumerate(names, start=1)
    ]
    return [StandingTable(competition=CompetitionRef(id="4351", name="Brasileirão"),
                          season="2026", rows=rows)]


def _ctx_with_team(db, **team_overrides) -> ProviderContext:
    team = {
        "name": "Cruzeiro",
        "logo": "https://cdn.test/cruzeiro.png",
        "ids": {"thesportsdb": "134294", "espn": "2022"},
        "competitions": [{"id": "4351", "name": "Brasileirão Série A"}],
    }
    team.update(team_overrides)
    ctx = build_context(db)
    ctx.team = team
    return ctx


def test_enrich_standings_sets_own_team_id_and_logo(db) -> None:
    tables = _table("Cruzeiro", "Atlético Mineiro")
    out = enrich_standings_logos(tables, db, _ctx_with_team(db))

    cruzeiro = out[0].rows[0]
    assert cruzeiro.team.id == "134294"
    assert cruzeiro.team.logo == "https://cdn.test/cruzeiro.png"
    assert out[0].rows[1].team.logo is None  # sem fonte de escudos, fica vazio


def test_enrich_standings_fills_bracket_tie_logos(db) -> None:
    """Escudos também entram nos confrontos do mata-mata."""
    tie = BracketTie(
        home=TeamRef(name="Cruzeiro"),
        away=TeamRef(name="Atlético Mineiro"),
        aggregate="2–1",
        winner="home",
        decided=True,
    )
    tables = [
        StandingTable(
            competition=CompetitionRef(id="4725", name="Copa do Brasil"),
            season="2026",
            rows=[],
            bracket=[tie],
        )
    ]
    out = enrich_standings_logos(tables, db, _ctx_with_team(db))

    assert out[0].bracket[0].home.id == "134294"
    assert out[0].bracket[0].home.logo == "https://cdn.test/cruzeiro.png"
    # sem fonte de escudos, o adversário fica vazio
    assert out[0].bracket[0].away.logo is None


def test_enrich_standings_matches_names_from_teams_source(db, fake_kind) -> None:
    _add_source(
        db,
        "Escudos",
        priority=50,
        capabilities=["teams"],
        mapping={"teams": [{"name": "Atlético-MG", "logo": "https://cdn.test/atletico.png"}]},
    )
    tables = _table("Cruzeiro", "Atlético Mineiro")
    out = enrich_standings_logos(tables, db, _ctx_with_team(db))

    assert out[0].rows[1].team.logo == "https://cdn.test/atletico.png"


def test_normalize_name_strips_common_suffixes() -> None:
    assert normalize_name("Cruzeiro Esporte Clube") == "cruzeiro esporte"
    assert normalize_name("SC Corinthians") == "corinthians"
    assert normalize_name("CR Vasco da Gama") == "vasco da gama"
    assert normalize_name("Atlético-MG") == "atletico mg"
    assert normalize_name("Futebol Clube Cruzeiro") == "cruzeiro"


def test_stats_position_from_standings_fills_missing_fields(db) -> None:
    stats = Stats(season=SeasonLine(competition=None, position=None, points=None))
    out = stats_position_from_standings(
        stats, _table("Cruzeiro", "Outro"), team_id="134294"
    )
    # sem id nas linhas, nada é preenchido (ids vêm do enriquecimento)
    assert out.season.position is None

    tables = _table("Cruzeiro", "Outro")
    tables[0].rows[0].team.id = "134294"
    out = stats_position_from_standings(stats, tables, team_id="134294")
    assert out.season.position == 1
    assert out.season.points == 29  # _table atribui 30 - posição
    assert out.season.competition == "Brasileirão"


def test_stats_position_creates_season_line_when_absent(db) -> None:
    tables = _table("Cruzeiro")
    tables[0].rows[0].team.id = "134294"
    out = stats_position_from_standings(Stats(), tables, team_id="134294")
    assert out.season is not None
    assert out.season.position == 1


# --------------------------------------------------------------------------- #
# is_empty / broadcasts / status
# --------------------------------------------------------------------------- #
def test_is_empty_covers_canonical_types() -> None:
    assert is_empty(None)
    assert is_empty([])
    assert is_empty("")
    assert is_empty({})
    assert is_empty(Stats())
    assert not is_empty(Stats(goals_scored=1))
    assert not is_empty([1])


def test_resolve_broadcasts_merges_and_deduplicates(db, fake_kind) -> None:
    _add_source(db, "TV", priority=10, capabilities=["tv"],
                mapping={"tv": [{"name": "Premiere"}, {"name": "SporTV"}]})
    _add_source(db, "Transmissões", priority=20, capabilities=["broadcasts"],
                mapping={"broadcasts": [{"name": "SporTV"}, {"name": "Globo"}]})

    class _Match:
        id = "12345"

    broadcasts, meta = resolve_broadcasts(db, _ctx(db), _Match())

    assert [b.name for b in broadcasts] == ["Premiere", "SporTV", "Globo"]
    assert meta is not None


def test_resolve_broadcasts_without_match_returns_empty(db) -> None:
    assert resolve_broadcasts(db, _ctx(db), None) == ([], None)


def test_match_date_uses_configured_timezone() -> None:
    from datetime import datetime

    from app.services.resolver import _match_date

    class _Match:
        kickoff = datetime(2026, 10, 13, 0, 0, tzinfo=timezone.utc)
        finished_at = None

    ctx = ProviderContext(team={"name": "Cruzeiro"}, season="2026",
                          timezone="America/Sao_Paulo")
    # 00:00 UTC = 21:00 do dia anterior em São Paulo (UTC-3)
    assert _match_date(ctx, _Match()) == "20261012"
    assert _match_date(ctx, None) is None


def test_resolve_broadcasts_uses_match_date_for_day_scoreboard(db, monkeypatch) -> None:
    """A busca de transmissões deve consultar a data do jogo, não a de hoje."""
    vistos: list[str] = []

    class DiaProvider(FakeProvider):
        def fetch(self, capability, ctx):
            vistos.append(ctx.date or "")
            return super().fetch(capability, ctx)

    monkeypatch.setitem(PROVIDERS, "fake", DiaProvider)
    _add_source(db, "TV dia", capabilities=["tv"], mapping={"tv": [{"name": "Premiere"}]})

    class _Match:
        id = "123"
        kickoff = datetime(2026, 10, 13, 0, 0, tzinfo=timezone.utc)
        finished_at = None

    ctx = ProviderContext(
        team={"name": "Cruzeiro", "ids": {}, "competitions": [{"id": "4351"}]},
        season="2026",
        timezone="America/Sao_Paulo",
    )
    broadcasts, _ = resolve_broadcasts(db, ctx, _Match())
    assert [b.name for b in broadcasts] == ["Premiere"]
    assert vistos == ["20261012"]


def test_runtime_status_is_recorded_and_clearable(db, fake_kind) -> None:
    source_id = _add_source(db, "Única", mapping={"news": [{"title": "A"}]})
    assert runtime_status(source_id, "news") is None

    resolve(db, "news", _ctx(db))
    status = runtime_status(source_id, "news")
    assert status["status"] == "ok"
    assert status["error"] is None

    clear_runtime_status()
    assert runtime_status(source_id, "news") is None


def test_resolver_rejects_unknown_capability_source(db, fake_kind) -> None:
    """Fonte habilitada mas sem a capacidade pedida => erro claro."""
    _add_source(db, "Só noticias", capabilities=["news"], mapping={"news": [{"title": "A"}]})
    value, meta = resolve(db, "standings", _ctx(db), allow_fallback=False)
    assert value is None
    assert meta.status == "error"
