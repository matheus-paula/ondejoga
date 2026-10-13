"""Widget "Tempo Real" (`live_match`): provedor, resolvedor, endpoint e layout.

O espelho real usado nos testes é o jogo Mirassol x Bahia (2026-10-11), que
estava em andamento na ESPN quando o recurso foi implementado.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import ApiSource
from app.providers import PROVIDERS, Provider, build_provider
from app.providers.base import (
    ProviderContext,
    ProviderError,
    SourceConfig,
    competition_ref,
    team_ref,
)
from app.providers.mapping import normalize_mapping
from app.schemas import Match
from app.services.resolver import (
    LIVE_TTL_SECONDS,
    build_context,
    resolve,
    runtime_status,
)
from app.services.store import get_layout, save_layout
from app.seed import seed_sources, upgrade_scopes
from fastapi.testclient import TestClient

# Payload real do placar da ESPN (2026-10-11): um jogo finalizado e o Bahia x
# Mirassol em andamento ("state": "in").
SCOREBOARD_LIVE = {
    "leagues": [{"id": "bra.1", "name": "Brazilian Serie A"}],
    "events": [
        {
            "id": "401841258",
            "date": "2026-10-11T19:00:00Z",
            "name": "Santos at Atlético-MG",
            "competitions": [
                {
                    "date": "2026-10-11T19:00:00Z",
                    "status": {"type": {"state": "post", "completed": True,
                                        "shortDetail": "FT"}},
                    "competitors": [
                        {"homeAway": "home", "score": "2",
                         "team": {"id": "109", "displayName": "Atlético-MG"}},
                        {"homeAway": "away", "score": "0",
                         "team": {"id": "111", "displayName": "Santos"}},
                    ],
                }
            ],
        },
        {
            "id": "401841266",
            "date": "2026-10-11T20:30:00Z",
            "name": "Mirassol at Bahia",
            "competitions": [
                {
                    "date": "2026-10-11T20:30:00Z",
                    "venue": {"fullName": "Arena Fonte Nova",
                              "address": {"city": "Salvador"}},
                    "status": {"type": {"state": "in", "completed": False,
                                        "detail": "48'", "shortDetail": "48'"}},
                    "competitors": [
                        {"homeAway": "home", "score": "1",
                         "team": {"id": "9967", "displayName": "Bahia"}},
                        {"homeAway": "away", "score": "0",
                         "team": {"id": "9169", "displayName": "Mirassol"}},
                    ],
                }
            ],
        },
    ],
}


def _espn_provider(payload) -> object:
    source = SourceConfig(
        id=1,
        name="ESPN",
        kind="espn",
        base_url="https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/",
        endpoints={"live_match": "scoreboard?dates={date}"},
    )
    provider = build_provider(source)
    provider.fetch_json = lambda capability, ctx, **extra: payload
    return provider


def _ctx(team_name: str, espn_id: str) -> ProviderContext:
    return ProviderContext(team={"name": team_name, "ids": {"espn": espn_id}},
                           season="2026")


# --------------------------------------------------------------------------- #
# Provedor ESPN
# --------------------------------------------------------------------------- #
def test_espn_live_match_returns_the_game_in_progress() -> None:
    provider = _espn_provider(SCOREBOARD_LIVE)
    match = provider.fetch("live_match", _ctx("Mirassol", "9169"))

    assert match.is_live is True
    assert match.id == "401841266"
    assert match.home.name == "Bahia" and match.home.score == 1
    assert match.away.name == "Mirassol" and match.away.score == 0
    assert match.status == "48'"
    assert match.finished_at is None  # ainda não acabou
    # o nome da liga vem do topo do placar do dia, em inglês, e sai traduzido
    assert match.competition.name == "Brasileirão Série A"
    assert match.venue is not None and match.venue.name == "Arena Fonte Nova"


def test_espn_live_match_ignores_finished_games() -> None:
    provider = _espn_provider(SCOREBOARD_LIVE)
    with pytest.raises(ProviderError, match="nenhum jogo ao vivo"):
        # Cruzeiro (2022) não joga nesta rodada: só há jogos "post" e um de
        # outro time em "in"
        provider.fetch("live_match", _ctx("Cruzeiro", "2022"))


def test_espn_live_match_also_matches_by_team_name() -> None:
    provider = _espn_provider(SCOREBOARD_LIVE)
    ctx = ProviderContext(team={"name": "Bahia", "ids": {}}, season="2026")
    match = provider.fetch("live_match", ctx)
    assert match.is_live is True
    assert match.home.name == "Bahia"


def test_espn_live_match_scans_today_and_yesterday() -> None:
    """O "dia" do placar da ESPN não segue o fuso: conferimos hoje e ontem."""
    calls: list[str] = []
    provider = _espn_provider(SCOREBOARD_LIVE)
    original = provider.fetch_json

    def spy(capability, ctx, **extra):
        calls.append(str(extra.get("date")))
        return original(capability, ctx, **extra)

    provider.fetch_json = spy
    match = provider.fetch("live_match", _ctx("Mirassol", "9169"))

    assert len(calls) == 2  # hoje e ontem
    assert calls[1] < calls[0]  # ontem vem depois
    assert match.is_live is True


# --------------------------------------------------------------------------- #
# Resolvedor: sem jogo agora é estado normal, e o TTL é curto
# --------------------------------------------------------------------------- #
class LiveFakeProvider(Provider):
    """Devolve o payload canônico definido nos atributos da classe."""

    kind = "livefake"
    payload: object = None
    error: str | None = None

    def fetch(self, capability: str, ctx: ProviderContext):
        if LiveFakeProvider.error:
            raise ProviderError(LiveFakeProvider.error)
        return LiveFakeProvider.payload


@pytest.fixture()
def live_kind(monkeypatch):
    monkeypatch.setitem(PROVIDERS, "livefake", LiveFakeProvider)
    LiveFakeProvider.payload = None
    LiveFakeProvider.error = None
    yield LiveFakeProvider
    LiveFakeProvider.payload = None
    LiveFakeProvider.error = None


def _add_live_source(db) -> int:
    row = ApiSource(
        name="Ao vivo",
        kind="livefake",
        priority=10,
        capabilities=["live_match"],
        base_url="https://fake.test/",
        mapping={},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id


def _live_match() -> Match:
    return Match(
        id="401841266",
        competition=competition_ref("bra.1", "Brasileirão Série A"),
        home=team_ref("9967", "Bahia", score=1),
        away=team_ref("9169", "Mirassol", score=0),
        status="48'",
        is_live=True,
    )


def test_resolve_live_without_a_match_is_ok_not_error(db, live_kind) -> None:
    source_id = _add_live_source(db)  # payload None => nenhum jogo em campo

    value, meta = resolve(db, "live_match", build_context(db))

    assert value is None
    assert meta.status == "ok"  # "sem jogo agora" não é falha da fonte
    assert meta.source == "Ao vivo"
    assert runtime_status(source_id, "live_match")["status"] == "ok"
    row = db.get(ApiSource, source_id)
    assert row.last_status == "ok"


def test_resolve_live_caps_the_cache_ttl(db, live_kind, monkeypatch) -> None:
    match = _live_match()
    live_kind.payload = match
    _add_live_source(db)
    seen: dict[str, int] = {}

    def spy(key, ttl, loader, **kwargs):
        seen["ttl"] = ttl
        return loader(), False

    monkeypatch.setattr("app.services.resolver.cached", spy)

    value, meta = resolve(db, "live_match", build_context(db))

    assert value is match
    assert meta.status == "ok"
    assert seen["ttl"] == LIVE_TTL_SECONDS


def test_resolve_live_reports_real_failures(db, live_kind) -> None:
    live_kind.error = "timeout ao chamar placar"
    source_id = _add_live_source(db)

    value, meta = resolve(db, "live_match", build_context(db), allow_fallback=False)

    assert value is None
    assert meta.status == "error"
    assert "timeout" in (meta.error or "")
    assert runtime_status(source_id, "live_match")["status"] == "error"


# --------------------------------------------------------------------------- #
# Mapeamento genérico (url_json) também entende live_match
# --------------------------------------------------------------------------- #
def test_url_json_mapping_marks_match_as_live() -> None:
    raw = {
        "match": {
            "id": "1",
            "competition_name": "Brasileirão Série A",
            "home_name": "Bahia",
            "home_score": 1,
            "away_name": "Mirassol",
            "away_score": 0,
            "status": "48'",
        }
    }
    spec = {
        "root": "match",
        "fields": {
            "id": "id",
            "competition_name": "competition_name",
            "home_name": "home_name",
            "home_score": "home_score",
            "away_name": "away_name",
            "away_score": "away_score",
            "status": "status",
        },
    }
    match = normalize_mapping(raw, spec, "live_match", source_name="genérica")
    assert match.is_live is True
    assert match.finished_at is None
    assert match.home.score == 1 and match.away.name == "Mirassol"


# --------------------------------------------------------------------------- #
# API: dashboard e endpoint dedicado
# --------------------------------------------------------------------------- #
def test_dashboard_exposes_live_match_field(client: TestClient) -> None:
    body = client.get("/api/dashboard").json()
    assert "live_match" in body
    assert body["live_match"] is None  # sem rede no teste => sem jogo em campo


def test_live_match_endpoint_returns_null_when_not_playing(client: TestClient) -> None:
    resp = client.get("/api/live-match")
    assert resp.status_code == 200
    assert resp.json() is None


# --------------------------------------------------------------------------- #
# Layout: "Tempo Real" no padrão e em layouts já gravados
# --------------------------------------------------------------------------- #
def test_default_layout_puts_live_match_first(db) -> None:
    layout = get_layout(db)
    first = sorted(layout["widgets"], key=lambda w: w["order"])[0]
    assert first["type"] == "live_match"
    assert first["title"] == "Tempo Real"


def test_stored_layout_gains_the_new_default_widget(db) -> None:
    legacy = {
        "theme": {"default": "system", "accent": "auto"},
        "refresh_interval_seconds": 300,
        "widgets": [
            {"id": "my_team", "type": "my_team", "title": "Meu Time",
             "visible": True, "order": 0, "size": "lg", "options": {}},
            {"id": "next_match", "type": "next_match", "title": "Próximo Jogo",
             "visible": False, "order": 1, "size": "md", "options": {}},
        ],
    }
    save_layout(db, legacy)
    layout = get_layout(db)

    ids = [w["id"] for w in layout["widgets"]]
    # a ordem que o usuário já tinha fica intacta
    assert ids[:2] == ["my_team", "next_match"]
    # os widgets novos do padrão entram no fim, incluindo o "Tempo Real"
    assert set(ids) >= {"my_team", "next_match", "last_match", "standings", "news",
                        "live_match"}
    live = next(w for w in layout["widgets"] if w["id"] == "live_match")
    assert live["type"] == "live_match"
    assert live["visible"] is True
    # entra depois dos widgets que o usuário já tinha (orders 0 e 1)
    assert live["order"] > 1
    # a personalização do usuário ficou intacta
    assert layout["widgets"][1]["visible"] is False


# --------------------------------------------------------------------------- #
# Migração das fontes semeadas em versões antigas
# --------------------------------------------------------------------------- #
def test_seed_upgrades_existing_sources_with_live_capability(db) -> None:
    row = ApiSource(
        name="ESPN",
        kind="espn",
        enabled=True,
        priority=20,
        capabilities=["team", "next_match"],  # fonte semeada numa versão antiga
        base_url="https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/",
        endpoints={"next_match": "teams/{team_id}/events"},
    )
    db.add(row)
    db.commit()

    assert seed_sources(db) == 0  # escopo já tem fontes => nada recriado
    db.refresh(row)
    assert "live_match" in row.capabilities
    assert row.capabilities.count("live_match") == 1
    assert row.endpoints["live_match"] == "scoreboard?dates={date}"
    # o que o usuário já tinha foi preservado
    assert row.endpoints["next_match"] == "teams/{team_id}/events"


def test_upgrade_scopes_migrates_every_owner(db) -> None:
    for owner in (None, 7):  # escopo global + uma conta existente
        db.add(
            ApiSource(
                name="ESPN",
                kind="espn",
                user_id=owner,
                capabilities=["team"],
                base_url="https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/",
                endpoints={},
            )
        )
    db.commit()

    upgrade_scopes(db)
    rows = db.scalars(select(ApiSource)).all()

    espn = [row for row in rows if row.kind == "espn"]
    assert len(espn) == 2  # uma por escopo (global + conta 7)
    assert all("live_match" in row.capabilities for row in espn)
    # capacidade que ficou órfã ganha a fonte padrão (aqui, a de transmissão)
    for owner in (None, 7):
        assert {"jogostv"} <= {row.kind for row in rows if row.user_id == owner}
    # segunda passada é idempotente: nada novo a cada reinício
    before = len(db.scalars(select(ApiSource)).all())
    upgrade_scopes(db)
    assert len(db.scalars(select(ApiSource)).all()) == before
