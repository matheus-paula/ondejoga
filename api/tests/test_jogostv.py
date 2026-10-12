"""Testes do adapter do JogosTV (grade de transmissão por jogo).

Nenhum teste acessa a rede: a página é uma fixture com o mesmo marcado do
site real (`article.game-row` com `data-channels` e `data-sem-transmissao`).
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import ApiSource
from app.providers import SourceConfig
from app.providers.jogostv import (
    JogoTVProvider,
    clear_page_cache,
    name_score,
    normalize,
    parse_rows,
    pick_row,
)
from app.providers.base import ProviderContext, ProviderError
from app.seed import seed_sources, upgrade_scopes

# Rodada com o marcado real do JogosTV: jogo confirmado, jogo sem transmissão,
# jogo só com o marcador "Canal a confirmar", jogo em outra data e dois times
# que começam igual ("Atletico-") para exercitar o desempate.
PAGE = """
<html><body>
<article class="game-row" data-data-iso="2026-10-11" data-fixture-id="1492400"
 data-channels="ge tv|Globo|Premiere" data-sem-transmissao="false">
 <div class="game-body" data-control-name="Atletico-MG x Santos">
  <span class="game-time">16:00</span>
  <span class="game-teams">
   <a class="team-link" href="/jogos-do-atletico-mg">Atletico-MG</a>
   <b class="game-versus">x</b>
   <a class="team-link" href="/jogos-do-santos">Santos</a>
  </span>
 </div>
</article>
<article class="game-row" data-data-iso="2026-10-11" data-fixture-id="1492401"
 data-channels="Premiere" data-sem-transmissao="false">
 <div class="game-body" data-control-name="Atletico Goianiense x Bahia">
  <span class="game-teams">
   <a class="team-link" href="/jogos-do-atletico-goianiense">Atletico Goianiense</a>
   <b class="game-versus">x</b>
   <a class="team-link" href="/jogos-do-bahia">Bahia</a>
  </span>
 </div>
</article>
<article class="game-row" data-data-iso="2026-10-11" data-fixture-id="1492402"
 data-channels="Canal a confirmar" data-sem-transmissao="true">
 <div class="game-body" data-control-name="Cruzeiro x Flamengo">
  <span class="game-teams">
   <a class="team-link" href="/jogos-do-cruzeiro">Cruzeiro</a>
   <b class="game-versus">x</b>
   <a class="team-link" href="/jogos-do-flamengo">Flamengo</a>
  </span>
 </div>
</article>
<article class="game-row" data-data-iso="2026-10-11" data-fixture-id="1492403"
 data-channels="Canal a confirmar" data-sem-transmissao="false">
 <div class="game-body" data-control-name="Corinthians x Palmeiras">
  <span class="game-teams">
   <a class="team-link" href="/jogos-do-corinthians">Corinthians</a>
   <b class="game-versus">x</b>
   <a class="team-link" href="/jogos-do-palmeiras">Palmeiras</a>
  </span>
 </div>
</article>
<article class="game-row" data-data-iso="2026-10-12" data-fixture-id="1492404"
 data-channels="SporTV" data-sem-transmissao="false">
 <div class="game-body" data-control-name="Sao Paulo x Santos">
  <span class="game-teams">
   <a class="team-link" href="/jogos-do-sao-paulo">Sao Paulo</a>
   <b class="game-versus">x</b>
   <a class="team-link" href="/jogos-do-santos">Santos</a>
  </span>
 </div>
</article>
</body></html>
"""


@pytest.fixture(autouse=True)
def _clean_page_cache():
    clear_page_cache()
    yield
    clear_page_cache()


def _ctx(team: str = "Atlético Mineiro", date: str = "20261011") -> ProviderContext:
    return ProviderContext(
        team={"name": team},
        season="2026",
        date=date,
        competition_ids=["4351"],
    )


def _provider() -> JogoTVProvider:
    source = SourceConfig(
        id=1,
        name="JogosTV",
        kind="jogostv",
        base_url="https://www.jogostv.com.br",
        endpoints={"tv": "{page}"},
        mapping={"pages": {"4351": "/jogos-do-brasileirao-serie-a"}},
    )
    provider = JogoTVProvider(source)
    provider.http.get_text = lambda url, params=None: PAGE  # sem rede
    return provider


# --------------------------------------------------------------------------- #
# Parser
# --------------------------------------------------------------------------- #
def test_parse_rows_reads_date_channels_and_teams() -> None:
    rows = parse_rows(PAGE)

    assert len(rows) == 5
    assert rows[0] == {
        "date": "2026-10-11",
        "channels": ["ge tv", "Globo", "Premiere"],
        "no_broadcast": False,
        "teams": ["Atletico-MG", "Santos"],
    }
    assert rows[2]["no_broadcast"] is True
    assert rows[1]["teams"] == ["Atletico Goianiense", "Bahia"]


def test_parse_rows_ignores_other_articles() -> None:
    html = '<article class="outra-coisa" data-channels="X"></article>' + PAGE
    assert len(parse_rows(html)) == 5


# --------------------------------------------------------------------------- #
# Casamento de nomes
# --------------------------------------------------------------------------- #
def test_normalize_strips_accents_punctuation_and_club_suffixes() -> None:
    assert normalize("São Paulo") == "sao paulo"
    assert normalize("Atlético-MG") == "atletico mg"
    assert normalize("Grêmio Foot-Ball") == "gremio foot ball"


def test_name_score_prefers_exact_then_word_then_first_word() -> None:
    assert name_score("botafogo", "botafogo") == 3
    assert name_score("botafogo pb", "botafogo") == 2  # palavra inteira contida
    assert name_score("atletico mineiro", "atletico mg") == 1  # mesma 1ª palavra
    assert name_score("internacional", "inter de limeira") == 0  # "inter" é curto
    assert name_score("sao bernardo", "sao paulo") == 0  # "sao" é curto
    assert name_score("", "botafogo") == 0


def test_pick_row_refuses_ambiguous_match() -> None:
    rows = parse_rows(PAGE)
    # "Bahia" só aparece num jogo em 11/10 — sem ambiguidade
    assert pick_row(rows, "2026-10-11", "bahia") is not None
    # dois jogos empatados com o mesmo candidato => não chuta
    dup = rows + [dict(rows[1], **{"teams": ["Bahia", "Vasco da Gama"]})]
    assert pick_row(dup, "2026-10-11", "bahia") is None


# --------------------------------------------------------------------------- #
# fetch
# --------------------------------------------------------------------------- #
def test_fetch_returns_channels_of_the_right_game() -> None:
    provider = _provider()
    broadcasts = provider.fetch("tv", _ctx())

    # "Atlético Mineiro" (TheSportsDB) casa com "Atletico-MG" (JogosTV) mesmo
    # tendo "Atletico Goianiense" na mesma rodada.
    assert [b.name for b in broadcasts] == ["ge tv", "Globo", "Premiere"]
    assert {b.country for b in broadcasts} == {"BR"}


def test_fetch_returns_empty_when_broadcast_is_not_confirmed() -> None:
    provider = _provider()
    # `data-sem-transmissao="true"` => lista vazia, não um chute
    assert provider.fetch("tv", _ctx(team="Cruzeiro")) == []
    # marcador "Canal a confirmar" descartado mesmo sem a flag de sem-transmissão
    assert provider.fetch("tv", _ctx(team="Corinthians")) == []


def test_fetch_uses_the_date_of_the_match() -> None:
    provider = _provider()
    assert [b.name for b in provider.fetch("tv", _ctx(team="São Paulo", date="20261012"))] \
        == ["SporTV"]
    # no dia errado o jogo não existe na grade
    with pytest.raises(ProviderError, match="não está na grade"):
        provider.fetch("tv", _ctx(team="São Paulo", date="20261011"))


def test_fetch_fails_when_team_is_unknown_or_game_absent() -> None:
    provider = _provider()
    with pytest.raises(ProviderError, match="não está na grade"):
        provider.fetch("tv", _ctx(team="Grêmio"))
    with pytest.raises(ProviderError, match="nenhum time"):
        provider.fetch("tv", _ctx(team=""))


def test_fetch_rejects_capabilities_it_does_not_serve() -> None:
    with pytest.raises(ProviderError, match="não atende"):
        _provider().fetch("news", _ctx())


def test_fetch_walks_every_configured_competition_page() -> None:
    """Jogo de copa não está na página do Brasileirão — e o default cobre a falta."""
    provider = _provider()
    provider.source.mapping = {
        "pages": {"4351": "/inexistente", "default": "/jogos-do-brasileirao-serie-a"}
    }
    pedidas: list[str] = []

    def fake_get_text(url: str, params=None) -> str:
        pedidas.append(url)
        return "" if url.endswith("/inexistente") else PAGE

    provider.http.get_text = fake_get_text

    assert [b.name for b in provider.fetch("tv", _ctx())] == ["ge tv", "Globo", "Premiere"]
    assert pedidas == [
        "https://www.jogostv.com.br/inexistente",
        "https://www.jogostv.com.br/jogos-do-brasileirao-serie-a",
    ]


def test_fetch_reports_network_error_when_no_page_loads() -> None:
    provider = _provider()
    provider.http.get_text = lambda url, params=None: (_ for _ in ()).throw(
        ProviderError("HTTP 500")
    )
    with pytest.raises(ProviderError, match="HTTP 500"):
        provider.fetch("tv", _ctx())


def test_page_is_fetched_once_per_round() -> None:
    provider = _provider()
    provider.fetch("tv", _ctx(team="Atlético Mineiro"))
    provider.fetch("tv", _ctx(team="Cruzeiro"))

    chamadas: list[str] = []
    provider.http.get_text = lambda url, params=None: (chamadas.append(url), PAGE)[1]
    provider.fetch("tv", _ctx(team="Santos"))
    provider.fetch("tv", _ctx(team="Flamengo"))

    assert chamadas == []  # a rodada de 2 MB não é baixada de novo


# --------------------------------------------------------------------------- #
# Seed / migração
# --------------------------------------------------------------------------- #
def test_seed_replaces_the_static_tv_list_with_jogostv(db) -> None:
    """Instalação que nasceu com a lista estática ganha a grade real."""
    antigas = [
        ("TheSportsDB", "thesportsdb", ["team", "next_match", "last_match"]),
        ("ESPN", "espn", ["team", "next_match", "broadcasts"]),
        ("Wikipédia", "wikipedia", ["standings"]),
        ("Google Notícias (RSS)", "rss", ["news"]),
        ("TV padrão (estático)", "static_json", ["tv"]),
    ]
    for name, kind, caps in antigas:
        db.add(ApiSource(name=name, kind=kind, capabilities=caps, enabled=True,
                         base_url="https://example.org/", endpoints={}))
    db.commit()

    upgrade_scopes(db)

    rows = {row.kind: row for row in db.scalars(select(ApiSource)).all()}
    assert rows["static_json"].enabled is False  # chute desligado, não apagado
    assert rows["jogostv"].enabled is True       # grade real no lugar
    assert "tv" in rows["jogostv"].capabilities
    # segunda passada é idempotente: nem fonte nova nem duplicata
    upgrade_scopes(db)
    assert len(db.scalars(select(ApiSource)).all()) == len(rows)


def test_fresh_scope_seeds_jogostv_and_no_static_list(db) -> None:
    seed_sources(db)

    kinds = {row.kind for row in db.scalars(select(ApiSource)).all()}
    assert "jogostv" in kinds
    assert not [
        row for row in db.scalars(select(ApiSource)).all()
        if row.kind == "static_json" and "tv" in (row.capabilities or [])
    ]


def test_disabling_a_source_does_not_resurrect_the_static_list(db) -> None:
    """Desligar uma fonte não faz o seed inventar outra para a mesma capacidade."""
    seed_sources(db)
    for row in db.scalars(select(ApiSource)).all():
        row.enabled = False
    db.commit()

    upgrade_scopes(db)

    rows = list(db.scalars(select(ApiSource)).all())
    assert len([row for row in rows if row.kind == "jogostv"]) == 1
    assert not [row for row in rows if row.kind == "static_json"]
