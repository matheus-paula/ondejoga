"""Testes dos adapters (provedores) e das funções puras de normalização.

Nenhum teste acessa a rede: URLs são validadas por composição e payloads
externos entram por fixtures gravadas ou por `Http.get_json` mockado.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.providers import PROVIDERS, build_provider
from app.providers.base import (
    Http,
    Provider,
    ProviderContext,
    ProviderError,
    SourceConfig,
    as_float,
    as_int,
    as_str,
    build_placeholders,
    parse_dt,
)
from app.providers.mapping import (
    normalize_mapping,
    project,
    record_to_broadcasts,
    resolve_path,
    rows_to_standings,
)
from app.providers.rss import parse_feed
from app.providers.wikipedia import parse_standings_table


# --------------------------------------------------------------------------- #
# Helpers de conversão
# --------------------------------------------------------------------------- #
def test_as_int_handles_espn_wrapped_values() -> None:
    assert as_int({"value": 2.0, "displayValue": "2"}) == 2
    assert as_int({"displayValue": "48"}) == 48
    assert as_int("48") == 48
    assert as_int("48%") == 0
    assert as_int(None, -1) == -1
    assert as_int("") == 0


def test_as_float_and_as_str() -> None:
    assert as_float({"value": "1.5"}) == 1.5
    assert as_float(None, 0.0) == 0.0
    assert as_str("") is None
    assert as_str(0) == "0"


def test_parse_dt_accepts_common_formats_as_utc() -> None:
    expected = datetime(2026, 10, 13, 0, 0, tzinfo=timezone.utc)
    assert parse_dt("2026-10-13T00:00:00Z") == expected
    assert parse_dt("2026-10-13 00:00:00") == expected
    assert parse_dt("2026-10-13") == expected
    assert parse_dt("20261013") == expected
    assert parse_dt(None) is None
    assert parse_dt("não é data") is None


# --------------------------------------------------------------------------- #
# Composição de URLs e placeholders
# --------------------------------------------------------------------------- #
def _ctx(**kwargs) -> ProviderContext:
    team = kwargs.pop(
        "team",
        {"name": "Cruzeiro", "ids": {"thesportsdb": "134294", "espn": "2022"},
         "competitions": [{"id": "4351", "name": "Brasileirão Série A"}]},
    )
    return ProviderContext(team=team, season="2026", **kwargs)


def test_build_placeholders_uses_provider_specific_team_id() -> None:
    ctx = _ctx()
    tsd = build_placeholders(ctx, SourceConfig(id=1, name="TSD", kind="thesportsdb"))
    espn = build_placeholders(ctx, SourceConfig(id=2, name="ESPN", kind="espn"))
    assert tsd["team_id"] == "134294"
    assert espn["team_id"] == "2022"
    assert tsd["competition_id"] == "4351"
    assert tsd["season"] == "2026"


def test_provider_url_joins_base_and_endpoint() -> None:
    source = SourceConfig(
        id=1,
        name="TheSportsDB",
        kind="thesportsdb",
        api_key="3",
        base_url="https://www.thesportsdb.com/api/v1/json/{api_key}/",
        endpoints={"next_match": "eventsnext.php?id={team_id}"},
    )
    url = build_provider(source).url("next_match", _ctx())
    assert url == "https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=134294"


def test_provider_url_supports_absolute_endpoint() -> None:
    source = SourceConfig(
        id=1,
        name="ESPN",
        kind="espn",
        base_url="https://site.api.espn.com/",
        endpoints={"next_match": "https://sports.core.api.espn.com/v2/x?season={year}"},
    )
    url = build_provider(source).url("next_match", _ctx())
    assert url == "https://sports.core.api.espn.com/v2/x?season=2026"


def test_provider_url_raises_without_endpoint_or_with_bad_placeholder() -> None:
    broken = SourceConfig(id=1, name="X", kind="espn", base_url="https://x.test/",
                          endpoints={"next_match": "{inexistente}"})
    with pytest.raises(ProviderError, match="endpoint inválido"):
        build_provider(broken).url("next_match", _ctx())

    no_endpoint = SourceConfig(id=2, name="RSS", kind="rss", base_url="https://x.test/")
    with pytest.raises(ProviderError, match="sem endpoint"):
        build_provider(no_endpoint).url("standings", _ctx())


def test_build_provider_rejects_unknown_kind() -> None:
    with pytest.raises(ProviderError, match="kind desconhecido"):
        build_provider(SourceConfig(id=1, name="X", kind="alienigena"))


def test_registered_kinds_cover_crud_options() -> None:
    assert set(PROVIDERS) >= {
        "thesportsdb", "espn", "rss", "football_data", "api_football",
        "url_json", "static_json", "wikipedia",
    }


# --------------------------------------------------------------------------- #
# Wikipédia: parser da tabela de classificação
# --------------------------------------------------------------------------- #
WIKI_HTML = """
<div>
<table class="wikitable">
<tr><th>Nota</th><th>Outra tabela</th></tr>
<tr><td colspan="2">não é a classificação</td></tr>
</table>
<table class="wikitable sortable">
<tr><th>Pos</th><th>Equipe</th><th>Pts</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr>
<tr>
  <td>1º</td>
  <td><span class="flag"></span> <a href="/wiki/Palmeiras">Palmeiras</a><sup>[1]</sup></td>
  <td>60</td><td>29</td><td>18</td><td>6</td><td>5</td><td>48</td><td>24</td><td>+24</td>
</tr>
<tr>
  <td>5</td>
  <td><a href="/wiki/Cruzeiro_Esporte_Clube">Cruzeiro</a></td>
  <td>48</td><td>29</td><td>14</td><td>6</td><td>9</td><td>44</td><td>40</td><td>+4</td>
</tr>
</table>
</div>
"""


def test_wikipedia_parser_extracts_rows_and_sorts_by_position() -> None:
    tables = parse_standings_table(
        WIKI_HTML,
        competition_id="4351",
        competition_name="Brasileirão Série A",
        season="2026",
        highlight_team_id="134294",
    )
    assert len(tables) == 1
    table = tables[0]
    assert table.competition.id == "4351"
    assert table.highlight_team_id == "134294"
    assert [r.position for r in table.rows] == [1, 5]
    leader, cruzeiro = table.rows
    assert leader.team.name == "Palmeiras"  # último link da célula
    assert leader.points == 60
    assert leader.goal_difference == 24
    assert cruzeiro.team.name == "Cruzeiro"
    assert cruzeiro.played == 29
    assert cruzeiro.lost == 9


def test_wikipedia_parser_raises_without_standings_table() -> None:
    with pytest.raises(ProviderError):
        parse_standings_table(
            "<table><tr><td>sem tabela</td></tr></table>",
            competition_id=None,
            competition_name="X",
            season="2026",
            highlight_team_id=None,
        )


# --------------------------------------------------------------------------- #
# RSS
# --------------------------------------------------------------------------- #
RSS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Google Notícias - Cruzeiro</title>
<item>
  <title>Cruzeiro vence o São Paulo &lt;b&gt;por 2 a 0&lt;/b&gt;</title>
  <link>https://example.com/noticia-1</link>
  <guid>https://example.com/noticia-1</guid>
  <pubDate>Sat, 10 Oct 2026 12:00:00 GMT</pubDate>
  <description>&lt;p&gt;Resumo da partida.&lt;/p&gt;</description>
</item>
<item>
  <title>Pré-jogo: Bragantino x Cruzeiro</title>
  <link>https://example.com/noticia-2</link>
  <guid>https://example.com/noticia-2</guid>
  <pubDate>Sun, 11 Oct 2026 09:30:00 GMT</pubDate>
</item>
</channel></rss>
"""


def test_rss_parser_normalizes_entries() -> None:
    items = parse_feed(RSS_XML, "Google Notícias", limit=10)
    assert len(items) == 2
    first = items[0]
    assert "<b>" not in first["title"]
    assert first["title"].startswith("Cruzeiro vence o São Paulo")
    assert first["summary"] == "Resumo da partida."
    assert first["url"] == "https://example.com/noticia-1"
    assert first["published_at"].year == 2026
    assert len(first["id"]) == 16
    assert first["source"] == "Google Notícias - Cruzeiro"
    # id estável para a mesma URL
    assert parse_feed(RSS_XML, "x", limit=1)[0]["id"] == first["id"]


def test_rss_parser_respects_limit_and_rejects_garbage() -> None:
    assert len(parse_feed(RSS_XML, "x", limit=1)) == 1
    with pytest.raises(ProviderError):
        parse_feed("isto não é um feed", "x")


# --------------------------------------------------------------------------- #
# static_json (transmissoras por competição)
# --------------------------------------------------------------------------- #
def _tv_source() -> SourceConfig:
    return SourceConfig(
        id=1,
        name="TV padrão",
        kind="static_json",
        capabilities=["tv"],
        mapping={
            "tv": {
                "by_competition": {
                    "4351": [{"name": "Premiere", "country": "BR"}],
                    "default": [{"name": "SporTV", "country": "BR"}],
                }
            }
        },
    )


def test_static_json_tv_uses_competition_then_default() -> None:
    provider = build_provider(_tv_source())
    ctx = _ctx()  # competição primária 4351
    assert [b.name for b in provider.fetch("tv", ctx)] == ["Premiere"]

    other = _ctx(team={"name": "Outro", "ids": {}, "competitions": [{"id": "9999"}]})
    assert [b.name for b in provider.fetch("tv", other)] == ["SporTV"]


def test_static_json_without_mapping_raises() -> None:
    provider = build_provider(SourceConfig(id=1, name="Vazio", kind="static_json"))
    with pytest.raises(ProviderError, match="sem 'mapping.tv'"):
        provider.fetch("tv", _ctx())


# --------------------------------------------------------------------------- #
# url_json: mapping declarativo (flexibilidade do CRUD)
# --------------------------------------------------------------------------- #
RAW_API = {
    "response": {
        "fixtures": [
            {"fixture": {"id": 1, "date": "2026-10-01T20:00:00Z"},
             "teams": {"home": {"id": 10, "name": "São Paulo"}, "away": {"id": 11, "name": "Cruzeiro"}},
             "goals": {"home": 0, "away": 2}},
            {"fixture": {"id": 2, "date": "2026-10-13T00:00:00Z"},
             "teams": {"home": {"id": 12, "name": "Bragantino"}, "away": {"id": 11, "name": "Cruzeiro"}},
             "goals": {"home": None, "away": None}},
        ]
    }
}

NEXT_MATCH_SPEC = {
    "root": "response.fixtures",
    "select": "next",
    "fields": {
        "id": "fixture.id",
        "kickoff": "fixture.date",
        "home_name": "teams.home.name",
        "home_id": "teams.home.id",
        "away_name": "teams.away.name",
        "away_id": "teams.away.id",
        "home_score": "goals.home",
        "away_score": "goals.away",
    },
}


def test_resolve_path_walks_dicts_and_lists() -> None:
    assert resolve_path(RAW_API, "response.fixtures.0.teams.home.name") == "São Paulo"
    assert resolve_path(RAW_API, "response.ausente", "padrão") == "padrão"
    assert resolve_path(RAW_API, "") is RAW_API
    assert resolve_path(RAW_API, "response.fixtures.99") is None


def test_project_maps_canonical_fields() -> None:
    record = project(RAW_API["response"]["fixtures"][1], NEXT_MATCH_SPEC["fields"])
    assert record["home_name"] == "Bragantino"
    assert record["away_name"] == "Cruzeiro"
    assert record["id"] == 2


def test_normalize_mapping_selects_next_match() -> None:
    now = datetime(2026, 10, 11, tzinfo=timezone.utc)
    match = normalize_mapping(
        RAW_API, NEXT_MATCH_SPEC, "next_match", highlight_team_id="11",
        season="2026", now=now, source_name="API genérica",
    )
    assert match.home.name == "Bragantino"
    assert match.away.name == "Cruzeiro"
    assert match.kickoff == datetime(2026, 10, 13, tzinfo=timezone.utc)
    assert match.status == "NS"
    assert match.source == "API genérica"


def test_normalize_mapping_last_match_is_finished_and_keeps_score() -> None:
    # select "finished" pega o jogo encerrado mais recente (mesmo que existam
    # partidas futuras mais distantes na lista)
    last_spec = dict(NEXT_MATCH_SPEC, select="finished")
    match = normalize_mapping(
        RAW_API, last_spec, "last_match", season="2026", source_name="API genérica"
    )
    assert match.home.name == "São Paulo"
    assert match.home.score == 0
    assert match.away.score == 2
    assert match.status == "FT"
    assert match.finished_at is not None


def test_normalize_mapping_select_last_picks_most_recent_date() -> None:
    last_spec = dict(NEXT_MATCH_SPEC, select="last")
    match = normalize_mapping(RAW_API, last_spec, "next_match", season="2026")
    assert match.kickoff == datetime(2026, 10, 13, tzinfo=timezone.utc)


def test_normalize_mapping_standings_and_news() -> None:
    standings = normalize_mapping(
        {"table": [{"pos": 1, "team": "Palmeiras", "pts": 60},
                   {"pos": 2, "team": "Cruzeiro", "pts": 48}]},
        {"root": "table",
         "fields": {"position": "pos", "team_name": "team", "points": "pts"}},
        "standings",
        season="2026",
        highlight_team_id="134294",
    )
    assert len(standings) == 1
    assert standings[0].rows[1].team.name == "Cruzeiro"
    assert standings[0].rows[1].points == 48
    assert standings[0].highlight_team_id == "134294"

    news = normalize_mapping(
        {"items": [{"title": "Manchete", "url": "https://n.example/1"}]},
        {"root": "items", "fields": {"title": "title", "url": "url"}},
        "news",
        source_name="API genérica",
    )
    assert news[0].title == "Manchete"
    assert news[0].source == "API genérica"


def test_normalize_mapping_rejects_bad_spec() -> None:
    with pytest.raises(ValueError):
        normalize_mapping({}, [], "news")
    with pytest.raises(ValueError):
        normalize_mapping({}, {"root": "x", "fields": {}}, "next_match")


def test_rows_to_standings_defaults_position_by_order() -> None:
    tables = rows_to_standings(
        [{"team_name": "A", "points": 10}, {"team_name": "B", "points": 9}],
        season="2026",
        highlight_team_id=None,
        default_competition="Copa",
    )
    assert [r.position for r in tables[0].rows] == [1, 2]
    assert tables[0].competition.name == "Copa"


def test_record_to_broadcasts_ignores_records_without_name() -> None:
    out = record_to_broadcasts([{"channel": "Premiere"}, {"sem_nome": True}])
    assert [b.name for b in out] == ["Premiere"]


def test_url_json_provider_requires_mapping_for_capability(monkeypatch) -> None:
    source = SourceConfig(
        id=1,
        name="API genérica",
        kind="url_json",
        base_url="https://api.test/",
        endpoints={"next_match": "fixtures.json"},
        mapping={},  # sem mapping configurado
    )
    provider = build_provider(source)
    with pytest.raises(ProviderError, match="mapping"):
        provider.fetch("next_match", _ctx())


def test_url_json_provider_maps_payload(monkeypatch) -> None:
    source = SourceConfig(
        id=1,
        name="API genérica",
        kind="url_json",
        base_url="https://api.test/",
        endpoints={"next_match": "fixtures.json"},
        mapping={"next_match": NEXT_MATCH_SPEC},
    )
    monkeypatch.setattr(Http, "get_json", lambda self, url, params=None: RAW_API)
    provider = build_provider(source)
    now = datetime(2026, 10, 11, tzinfo=timezone.utc)
    match = provider.fetch("next_match", _ctx(now=now))
    assert match.home.name == "Bragantino"
    assert match.away.name == "Cruzeiro"
    assert match.source == "API genérica"
