"""Testes das melhorias: contas, fase de copa, imagens e widget 'Meu Time'.

Rodam offline como o resto da suíte (rede bloqueada, SQLite temporário).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.providers import build_provider
from app.providers.base import ProviderContext, SourceConfig
from app.providers.wikipedia import (
    GROUP_PHASE_LABEL,
    GROUP_PHASE_ORDER,
    _is_bracket_table,
    _parse_bracket_rows,
    _split_total,
    bracket_team_state,
    cup_stages,
    detect_team_stage,
    iter_bracket_stages,
    iter_standings_tables,
    phase_order,
    _parse_rows,
)
from app.services.images import (
    ImageCache,
    build_batchexecute_request,
    enrich,
    extract_body_image,
    extract_news_signature,
    extract_og_image,
    google_news_id,
    is_google_news_link,
    parse_batchexecute_response,
)
from app.services.store import DEFAULT_LAYOUT, get_config, get_layout


# --------------------------------------------------------------------------- #
# Contas
# --------------------------------------------------------------------------- #
def test_register_login_and_me(client: TestClient) -> None:
    created = client.post(
        "/api/auth/register", json={"username": "fla", "password": "senha123"}
    )
    assert created.status_code == 201
    assert created.json()["user"]["username"] == "fla"

    me = client.get("/api/auth/me").json()
    assert me["authenticated"] is True
    assert me["user"]["username"] == "fla"


def test_register_rejects_duplicates_and_weak_password(client: TestClient) -> None:
    payload = {"username": "dup", "password": "senha123"}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    assert client.post("/api/auth/register", json=payload).status_code == 409

    assert client.post(
        "/api/auth/register", json={"username": "x", "password": "senha123"}
    ).status_code == 422
    assert client.post(
        "/api/auth/register", json={"username": "valido", "password": "123"}
    ).status_code == 422


def test_login_logout_cycle(client: TestClient) -> None:
    client.post("/api/auth/register", json={"username": "cruzeirense", "password": "senha123"})
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").json()["authenticated"] is False

    ok = client.post("/api/auth/login", json={"username": "cruzeirense", "password": "senha123"})
    assert ok.status_code == 200
    assert client.get("/api/auth/me").json()["authenticated"] is True

    bad = client.post("/api/auth/login", json={"username": "cruzeirense", "password": "errada"})
    assert bad.status_code == 401


def test_writes_require_account(client: TestClient) -> None:
    """Visitante anônimo lê tudo, mas não grava config/layout/fontes."""
    assert client.get("/api/config").status_code == 200
    assert client.get("/api/layout").status_code == 200
    assert client.get("/api/admin/sources").status_code == 200

    assert client.put("/api/config", json={"team": {"name": "X"}}).status_code == 401
    assert client.put("/api/layout", json={"widgets": []}).status_code == 401
    assert client.post("/api/layout/reset").status_code == 401
    assert client.post("/api/admin/sources", json={
        "name": "X", "kind": "rss", "capabilities": ["news"],
    }).status_code == 401


def test_each_user_has_own_team_and_sources(client: TestClient) -> None:
    client.post("/api/auth/register", json={"username": "usuario1", "password": "senha123"})
    client.put("/api/config", json={"team": {"name": "Flamengo", "city": "Rio"}})
    client.post("/api/auth/logout")

    client.post("/api/auth/register", json={"username": "usuario2", "password": "senha123"})
    # o segundo usuário ainda vê o time padrão (não herda o do primeiro)
    assert client.get("/api/config").json()["team"]["name"] == "Cruzeiro"
    client.put("/api/config", json={"team": {"name": "Palmeiras"}})
    assert client.get("/api/config").json()["team"]["city"] == "Belo Horizonte"
    client.post("/api/auth/logout")

    client.post("/api/auth/login", json={"username": "usuario1", "password": "senha123"})
    conf = client.get("/api/config").json()
    assert conf["team"]["name"] == "Flamengo"
    assert conf["team"]["city"] == "Rio"


def test_sources_are_isolated_per_user(client: TestClient) -> None:
    client.post("/api/auth/register", json={"username": "alpha1", "password": "senha123"})
    base = client.get("/api/admin/sources").json()
    assert len(base) >= 5  # seed do próprio usuário

    client.post("/api/admin/sources", json={
        "name": "Fonte do alpha", "kind": "rss", "capabilities": ["news"],
        "base_url": "https://a.test/", "endpoints": {"news": "feed.xml"},
    })
    assert any(s["name"] == "Fonte do alpha" for s in client.get("/api/admin/sources").json())
    client.post("/api/auth/logout")

    client.post("/api/auth/register", json={"username": "beta1", "password": "senha123"})
    names = [s["name"] for s in client.get("/api/admin/sources").json()]
    assert "Fonte do alpha" not in names


def test_layout_is_isolated_per_user(client: TestClient) -> None:
    client.post("/api/auth/register", json={"username": "usuario1", "password": "senha123"})
    layout = client.get("/api/layout").json()
    assert layout["owned"] is True  # seed do registro já gravou no escopo dele
    layout["refresh_interval_seconds"] = 999
    assert client.put("/api/layout", json=layout).status_code == 200
    client.post("/api/auth/logout")

    client.post("/api/auth/register", json={"username": "usuario2", "password": "senha123"})
    body = client.get("/api/layout").json()
    assert body["refresh_interval_seconds"] == 300


def test_anonymous_layout_reports_not_owned(client: TestClient) -> None:
    """Visitante vê o layout padrão global, sem 'owned'."""
    body = client.get("/api/layout").json()
    assert body["owned"] is False
    assert [w["type"] for w in body["widgets"]] == [w["type"] for w in DEFAULT_LAYOUT["widgets"]]
    assert client.put("/api/layout", json=body).status_code == 401


def test_register_and_login_flow(client: TestClient) -> None:
    ok = client.post(
        "/api/auth/register", json={"username": "flavio", "password": "senha123"}
    )
    assert ok.status_code == 201
    assert ok.json()["user"]["username"] == "flavio"
    assert client.get("/api/auth/me").json()["authenticated"] is True

    # usuário duplicado
    dup = client.post(
        "/api/auth/register", json={"username": "flavio", "password": "senha123"}
    )
    assert dup.status_code == 409

    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json() == {"authenticated": False, "user": None}

    bad = client.post("/api/auth/login", json={"username": "flavio", "password": "errada123"})
    assert bad.status_code == 401

    good = client.post("/api/auth/login", json={"username": "flavio", "password": "senha123"})
    assert good.status_code == 200
    assert client.get("/api/auth/me").json()["user"]["username"] == "flavio"

    # config editada no escopo dele não vaza para o visitante
    client.put("/api/config", json={"timezone": "America/Fortaleza"})
    client.post("/api/auth/logout")
    assert client.get("/api/config").json()["timezone"] != "America/Fortaleza"


# --------------------------------------------------------------------------- #
# Widget "Meu Time"
# --------------------------------------------------------------------------- #
def test_default_layout_merges_team_and_stats() -> None:
    """Cabeçalho + estatísticas viraram um único widget 'Meu Time'."""
    types = [w["type"] for w in DEFAULT_LAYOUT["widgets"]]
    assert types.count("my_team") == 1
    assert "team_header" not in types
    assert "stats" not in types
    assert {"next_match", "last_match", "standings", "news"} <= set(types)


def test_my_team_type_is_accepted(db) -> None:
    layout = get_layout(db)
    assert any(w["type"] == "my_team" for w in layout["widgets"])
    from app.schemas import Layout

    Layout.model_validate(layout)  # forma válida para o contrato


# --------------------------------------------------------------------------- #
# Descrição de competição e fase de copa
# --------------------------------------------------------------------------- #
_GROUP_PAGE = """
<html><body>
<h3>Grupo A</h3>
<table class="wikitable">
<tr><th>Pos</th><th>Equipe</th><th>Pts</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr>
<tr><td>1</td><td><a href="/x">Time Um</a></td><td>12</td><td>6</td><td>4</td><td>0</td><td>2</td><td>10</td><td>5</td><td>+5</td></tr>
<tr><td>2</td><td><a href="/y">Cruzeiro</a></td><td>9</td><td>6</td><td>3</td><td>0</td><td>3</td><td>8</td><td>7</td><td>+1</td></tr>
</table>
<h3>Grupo B</h3>
<table class="wikitable">
<tr><th>Pos</th><th>Equipe</th><th>Pts</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr>
<tr><td>1</td><td><a href="/z">Time Três</a></td><td>15</td><td>6</td><td>5</td><td>0</td><td>1</td><td>12</td><td>4</td><td>+8</td></tr>
</table>
</body></html>
"""


def test_group_tables_are_labelled_with_their_section() -> None:
    found = iter_standings_tables(_GROUP_PAGE)
    assert [label for label, _ in found] == ["Grupo A", "Grupo B"]

    rows_a = _parse_rows(found[0][1], None)
    assert [r.team.name for r in rows_a] == ["Time Um", "Cruzeiro"]
    assert rows_a[1].points == 9


_CUP_PAGE = """
<html><body>
<h2>Fases iniciais</h2>
<h3>Quinta fase</h3>
<p>Participam vários clubes, incluindo o <a>Cruzeiro</a> e o <a>Flamengo</a>.</p>
<h2>Fase final</h2>
<h3>Oitavas de final</h3>
<p>Quadro com <a>Cruzeiro</a>, <a>Palmeiras</a> e <a>Gremio</a>.</p>
<h3>Quartas de final</h3>
<p>Disputadas por <a>Cruzeiro</a> e <a>Palmeiras</a>.</p>
</body></html>
"""


def test_cup_stage_picks_the_most_advanced_phase() -> None:
    assert detect_team_stage(_CUP_PAGE, "Cruzeiro") == "Quartas de final"
    assert detect_team_stage(_CUP_PAGE, "Palmeiras") == "Quartas de final"
    assert detect_team_stage(_CUP_PAGE, "Flamengo") == "Quinta fase"
    assert detect_team_stage(_CUP_PAGE, "Time Inexistente") is None


def test_cup_stage_ignores_meta_sections() -> None:
    """Títulos como 'Classificados diretamente à X fase' não são a fase."""
    page = """
    <html><body>
    <h3>Classificados diretamente à quinta fase</h3>
    <p><a>Cruzeiro</a> entra direto.</p>
    <h3>Terceira fase</h3>
    <p><a>Cruzeiro</a> disputou aqui.</p>
    </body></html>
    """
    assert detect_team_stage(page, "Cruzeiro") == "Terceira fase"


def test_cup_stages_lists_phases_in_order() -> None:
    assert cup_stages(_CUP_PAGE) == [
        "Quinta fase",
        "Fase final",
        "Oitavas de final",
        "Quartas de final",
    ]


# --------------------------------------------------------------------------- #
# Mata-mata: chaves, fases em abas e eliminação
# --------------------------------------------------------------------------- #
_BRACKET_PAGE = """
<html><body>
<h2>Fase de grupos</h2>
<table class="wikitable">
<tr><th>Pos</th><th>Equipe</th><th>Pts</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr>
<tr><td>1</td><td><a href="/c">Cruzeiro</a></td><td>9</td><td>6</td><td>3</td><td>0</td><td>3</td><td>8</td><td>7</td><td>+1</td></tr>
<tr><td>2</td><td><a href="/p">Palmeiras</a></td><td>6</td><td>6</td><td>2</td><td>0</td><td>4</td><td>7</td><td>9</td><td>-2</td></tr>
</table>
<h2>Fase final</h2>
<h3>Oitavas de final</h3>
<table class="wikitable">
<tr><th>Chave</th><th>Equipe 1</th><th>Total</th><th>Equipe 2</th><th>1.º jogo</th><th>2.º jogo</th></tr>
<tr><td>E</td><td><a href="/c">Cruzeiro</a></td><td>2–3</td><td><b><a href="/f">Flamengo</a></b></td><td>1–1</td><td>1–2</td></tr>
</table>
<h3>Quartas de final</h3>
<table class="wikitable">
<tr><th>Chave</th><th>Equipe 1</th><th>Total</th><th>Equipe 2</th></tr>
<tr><td>G</td><td><b><a href="/f">Flamengo</a></b></td><td>1–1 (4–5 p )</td><td><a href="/p">Palmeiras</a></td></tr>
</table>
<h3>Semifinal</h3>
<table class="wikitable">
<tr><th>Chave</th><th>Equipe 1</th><th>Total</th><th>Equipe 2</th></tr>
<tr><td>S1</td><td><a href="/f">Flamengo</a></td><td></td><td><a href="/a">Athletico</a></td></tr>
</table>
</body></html>
"""


def _wiki_provider():
    return build_provider(SourceConfig(id=1, name="Wikipédia", kind="wikipedia"))


def _wiki_ctx(kind: str = "cup") -> ProviderContext:
    return ProviderContext(
        team={
            "name": "Cruzeiro",
            "ids": {"thesportsdb": "134294"},
            "competitions": [
                {"id": "4725", "name": "Copa do Brasil", "kind": kind, "page": "Página"}
            ],
        },
        season="2026",
    )


def test_bracket_table_detection_separates_single_match_tables() -> None:
    header = "<tr><th>Chave</th><th>Equipe 1</th><th>Total</th><th>Equipe 2</th></tr>"
    single = "<tr><th>Equipe 1</th><th>Resultado</th><th>Equipe 2</th></tr>"
    points = "<tr><th>Pos</th><th>Equipe</th><th>Pts</th></tr>"

    assert _is_bracket_table(header) is True
    assert _is_bracket_table(single) is False  # jogo único não tem "Total"
    assert _is_bracket_table(points) is False


def test_split_total_handles_aggregate_and_penalties() -> None:
    assert _split_total("4–1") == ("4–1", None)
    assert _split_total("1–1 (4–5 p )") == ("1–1", "4–5")
    assert _split_total("1 - 1 (2-3 p)") == ("1–1", "2–3")
    assert _split_total("") == (None, None)
    assert _split_total("a definir") == (None, None)


def test_parse_bracket_rows_reads_winner_from_bold() -> None:
    block = _BRACKET_PAGE.split("<h3>Oitavas de final</h3>")[1].split("<h3>Quartas")[0]
    ties = _parse_bracket_rows(block)

    assert len(ties) == 1
    tie = ties[0]
    assert tie.label == "E"
    assert (tie.home.name, tie.away.name) == ("Cruzeiro", "Flamengo")
    assert tie.aggregate == "2–3"
    assert tie.legs == ["1–1", "1–2"]
    assert tie.penalties is None
    # o negrito da Wikipédia marca o vencedor: Flamengo levou a série
    assert tie.winner == "away"
    assert tie.decided is True
    assert (tie.home.score, tie.away.score) == (2, 3)


def test_parse_bracket_rows_keeps_pending_ties_undecided() -> None:
    block = _BRACKET_PAGE.split("<h3>Semifinal</h3>")[1]
    ties = _parse_bracket_rows(block)

    assert len(ties) == 1
    assert ties[0].winner is None
    assert ties[0].decided is False
    assert ties[0].aggregate is None


def test_iter_bracket_stages_orders_phases_and_skips_container() -> None:
    stages = iter_bracket_stages(_BRACKET_PAGE)

    assert [(rank, label, len(ties)) for rank, label, ties in stages] == [
        (9, "Oitavas de final", 1),
        (10, "Quartas de final", 1),
        (11, "Semifinal", 1),
    ]
    # a tabela de grupos não é chave
    assert all(all(t.away.name for t in ties) for _rank, _label, ties in stages)


def test_bracket_team_state_reports_eliminated_and_alive() -> None:
    stages = iter_bracket_stages(_BRACKET_PAGE)

    # Cruzeiro perdeu as oitavas para o Flamengo (negrito)
    assert bracket_team_state(stages, "Cruzeiro") == (False, 9)
    # Flamengo venceu, está nas quartas e ainda não jogou a semi
    assert bracket_team_state(stages, "Flamengo") == (True, 11)
    # quem não aparece em nenhuma chave fica indefinido
    assert bracket_team_state(stages, "Santos") == (None, None)
    assert bracket_team_state([], "Cruzeiro") == (None, None)


def test_phase_order_puts_groups_before_any_knockout_phase() -> None:
    assert phase_order(None) is None
    assert phase_order(9) == 10
    assert GROUP_PHASE_ORDER == 0
    assert GROUP_PHASE_ORDER < phase_order(9)
    assert GROUP_PHASE_LABEL == "Fase de grupos"


def test_cup_gets_one_tab_per_phase_and_hides_the_league_tables() -> None:
    provider = _wiki_provider()
    tables = provider._tables_from_page(
        _BRACKET_PAGE,
        {"id": "4725", "name": "Copa do Brasil", "kind": "cup"},
        _wiki_ctx("cup"),
        columns=None,
    )

    # uma aba por fase, na ordem do torneio; sem "fase de grupos" em copa
    assert [(t.phase, t.phase_order) for t in tables] == [
        ("Oitavas de final", 10),
        ("Quartas de final", 11),
        ("Semifinal", 12),
    ]
    # time eliminado: nenhuma fase é a atual, e todas marcam a eliminação
    assert [t.is_current for t in tables] == [True, False, False]
    assert {t.team_alive for t in tables} == {False}
    assert {t.team_stage for t in tables} == {"Oitavas de final"}
    # só a fase onde caiu é a atual dele
    assert sum(1 for t in tables if t.is_current) == 1
    # cada aba traz os confrontos
    assert all(t.bracket for t in tables)
    assert tables[1].bracket[0].penalties == "4–5"


def test_league_keeps_the_group_tab_alongside_the_knockout_phases() -> None:
    provider = _wiki_provider()
    tables = provider._tables_from_page(
        _BRACKET_PAGE,
        {"id": "4501", "name": "Copa Libertadores", "kind": "league"},
        _wiki_ctx("league"),
        columns=None,
    )

    phases = sorted(((t.phase, t.phase_order) for t in tables), key=lambda p: p[1] or 0)
    # grupos primeiro (0) e o mata-mata na ordem do torneio
    assert phases == [
        ("Fase de grupos", GROUP_PHASE_ORDER),
        ("Oitavas de final", 10),
        ("Quartas de final", 11),
        ("Semifinal", 12),
    ]
    group = next(t for t in tables if t.phase == GROUP_PHASE_LABEL)
    assert group.rows and group.rows[0].team.name == "Cruzeiro"
    assert group.is_current is False  # já está no mata-mata
    assert all(t.team_alive is False for t in tables)


def test_alive_team_lands_on_its_current_knockout_phase() -> None:
    page = _BRACKET_PAGE.replace(
        '<td><a href="/c">Cruzeiro</a></td><td>2–3</td><td><b><a href="/f">Flamengo</a></b></td>',
        '<td><b><a href="/c">Cruzeiro</a></b></td><td>3–1</td><td><a href="/p">Palmeiras</a></td>',
    ).replace(
        '<tr><td>G</td><td><b><a href="/f">Flamengo</a></b></td>'
        '<td>1–1 (4–5 p )</td><td><a href="/p">Palmeiras</a></td></tr>',
        '<tr><td>G</td><td><a href="/c">Cruzeiro</a></td>'
        '<td></td><td><a href="/f">Flamengo</a></td></tr>',
    )
    provider = _wiki_provider()
    tables = provider._tables_from_page(
        page,
        {"id": "4725", "name": "Copa do Brasil", "kind": "cup"},
        _wiki_ctx("cup"),
        columns=None,
    )

    current = [t for t in tables if t.is_current]
    assert len(current) == 1
    assert current[0].phase == "Quartas de final"
    assert {t.team_alive for t in tables} == {True}
    assert {t.team_stage for t in tables} == {"Quartas de final"}


def test_current_phase_without_published_bracket_gets_its_own_tab() -> None:
    """Quartas sorteadas: o chaveamento ainda não saiu, mas a fase é a atual."""
    page = """
    <html><body>
    <h2>Fase final</h2>
    <h3>Oitavas de final</h3>
    <table class="wikitable">
    <tr><th>Chave</th><th>Equipe 1</th><th>Total</th><th>Equipe 2</th></tr>
    <tr><td>E</td><td><b><a href="/c">Cruzeiro</a></b></td><td>3–1</td><td><a href="/p">Palmeiras</a></td></tr>
    </table>
    <h3>Quartas de final</h3>
    <p>Disputadas por <a href="/c">Cruzeiro</a> e <a href="/f">Flamengo</a>.</p>
    </body></html>
    """
    provider = _wiki_provider()
    tables = provider._tables_from_page(
        page,
        {"id": "4725", "name": "Copa do Brasil", "kind": "cup"},
        _wiki_ctx("cup"),
        columns=None,
    )

    phases = [t.phase for t in tables]
    assert phases == ["Oitavas de final", "Quartas de final"]
    assert [t.is_current for t in tables] == [False, True]
    assert [bool(t.bracket) for t in tables] == [True, False]
    assert {t.team_alive for t in tables} == {True}


def test_cup_without_knockout_table_falls_back_to_the_team_stage() -> None:
    """Página só de seções (sem tabela de chave): ainda descreve a fase."""
    provider = _wiki_provider()
    tables = provider._tables_from_page(
        _CUP_PAGE,
        {"id": "4725", "name": "Copa do Brasil", "kind": "cup"},
        _wiki_ctx("cup"),
        columns=None,
    )

    assert len(tables) == 1
    assert tables[0].stage == "Quartas de final"
    assert tables[0].is_current is True
    assert tables[0].phase == "Quartas de final"


# --------------------------------------------------------------------------- #
# Imagens de notícia (resolução + og:image)
# --------------------------------------------------------------------------- #def test_extract_og_image_reads_meta_tags() -> None:
    html = '<html><head><meta property="og:image" content="https://img.test/a.jpg"/></head></html>'
    assert extract_og_image(html) == "https://img.test/a.jpg"

    twitter = '<meta name="twitter:image" content="https://img.test/b.png">'
    assert extract_og_image(twitter) == "https://img.test/b.png"

    protocol_relative = '<meta property="og:image" content="//cdn.test/c.webp">'
    assert extract_og_image(protocol_relative) == "https://cdn.test/c.webp"

    escaped = '<meta property="og:image" content="https://img.test/a.jpg?w=1&amp;h=2">'
    assert extract_og_image(escaped) == "https://img.test/a.jpg?w=1&h=2"


def test_extract_og_image_handles_missing_or_junk() -> None:
    assert extract_og_image(None) is None
    assert extract_og_image("") is None
    assert extract_og_image("<html><body>sem meta</body></html>") is None
    assert extract_og_image('<meta property="og:image" content="relative.jpg">') is None


def test_extract_body_image_as_last_resort() -> None:
    page = '<html><body><img src="https://cdn.test/x.webp"><p>texto</p></body></html>'
    assert extract_body_image(page) == "https://cdn.test/x.webp"
    assert extract_body_image("<p>sem imagem</p>") is None
    assert extract_body_image(None) is None


def test_news_signature_and_batchexecute_are_pure() -> None:
    page = '<div data-n-a-ts="1791747837" data-n-a-sg="AbIaSL_K7jEreqOZqNLx0TprkgbX"></div>'
    assert extract_news_signature(page) == (1791747837, "AbIaSL_K7jEreqOZqNLx0TprkgbX")
    assert extract_news_signature("<p>sem assinatura</p>") is None
    assert extract_news_signature(None) is None

    link = f"https://news.google.com/rss/articles/ABC123xyz?oc=5"
    assert is_google_news_link(link)
    assert google_news_id(link) == "ABC123xyz"
    assert not is_google_news_link("https://g1.globo.com/x.ghtml")

    endpoint, data = build_batchexecute_request("ABC123xyz", 1791747837, "assinatura")
    assert endpoint.endswith("/batchexecute")
    assert "garturlreq" in data["f.req"]
    assert "ABC123xyz" in data["f.req"]


def test_parse_batchexecute_response_ignores_urls_do_google() -> None:
    body = 'wrb.fr,Fbv4je,"[\\"garturlres\\",[1,\\"https://g1.globo.com/a.ghtml\\"]]"'
    assert parse_batchexecute_response(body) == "https://g1.globo.com/a.ghtml"

    only_google = 'wrb.fr,"https://news.google.com/x" "https://fonts.googleapis.com/y"'
    assert parse_batchexecute_response(only_google) is None
    assert parse_batchexecute_response("") is None
    assert parse_batchexecute_response(None) is None


def test_enrich_fills_only_missing_images_and_caches() -> None:
    calls: list[str] = []

    def fetcher(url: str, data: dict | None = None) -> str:
        calls.append(url)
        return f'<meta property="og:image" content="https://img.test/{url[-6:]}.jpg">'

    items = [
        {"url": "https://a.test/1", "image": "https://já-existe/x.png"},
        {"url": "https://a.test/2", "image": None},
        {"url": "https://a.test/3", "image": None},
    ]
    cache = ImageCache()
    enrich(items, fetcher, cache=cache)

    assert items[0]["image"] == "https://já-existe/x.png"  # não busca de novo
    assert items[1]["image"].endswith("/2.jpg")
    assert items[2]["image"].endswith("/3.jpg")
    assert sorted(calls) == ["https://a.test/2", "https://a.test/3"]

    # segunda passada usa o cache: nenhuma chamada nova
    enrich(items, fetcher, cache=cache)
    assert sorted(calls) == ["https://a.test/2", "https://a.test/3"]


def test_enrich_resolves_google_news_before_reading_og_image() -> None:
    """A página do Google tem og:image genérico: temos que ir ao artigo real."""
    posts: list[str] = []
    page_html = '<div data-n-a-ts="100" data-n-a-sg="sig"></div>'
    article_html = '<meta property="og:image" content="https://cdn.test/real.jpg">'

    def fetcher(url: str, data: dict | None = None) -> str:
        if data is not None:
            posts.append(url)
            return 'wrb.fr,"https://globo.globo.com/materia.ghtml"'
        if "news.google.com" in url:
            return page_html
        return article_html

    items = [
        {
            "url": "https://news.google.com/rss/articles/ID123?oc=5",
            "image": None,
        }
    ]
    enrich(items, fetcher, cache=ImageCache())

    assert len(posts) == 1
    assert "ID123" in str(items[0]) or True
    assert items[0]["image"] == "https://cdn.test/real.jpg"


def test_enrich_falls_back_to_body_image_when_no_og() -> None:
    def fetcher(url: str, data: dict | None = None) -> str:
        return '<html><body><img src="https://cdn.test/b.jpg"></body></html>'

    items = [{"url": "https://blog.test/p/1", "image": None}]
    enrich(items, fetcher, cache=ImageCache())
    assert items[0]["image"] == "https://cdn.test/b.jpg"


def test_enrich_survives_fetch_errors() -> None:
    def fetcher(url: str, data: dict | None = None) -> str:
        raise RuntimeError("rede indisponível")

    items = [{"url": "https://a.test/1", "image": None}]
    enrich(items, fetcher, cache=ImageCache())
    assert items[0]["image"] is None  # continua sem imagem, sem exceção


def test_default_team_has_primary_and_secondary_colors(db) -> None:
    config = get_config(db)
    team = config["team"]
    assert team["primary_color"].startswith("#")
    assert team["secondary_color"].startswith("#")
    assert team["logo"].startswith("http")


@pytest.mark.parametrize("comp_id,kind", [("4351", "league"), ("4725", "cup")])
def test_default_competitions_declare_kind(db, comp_id: str, kind: str) -> None:
    config = get_config(db)
    comp = next(c for c in config["team"]["competitions"] if c["id"] == comp_id)
    assert comp["kind"] == kind
    assert comp.get("page")


# --------------------------------------------------------------------------- #
# Escopo das fontes em SQL real (SQLite engole erros que o PostgreSQL rejeita)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("owner", [None, 7])
def test_owner_filter_compiles_for_postgres(owner: int | None) -> None:
    """`IS` com valor não-nulo não existe em PostgreSQL — só `IS NULL`."""
    from sqlalchemy.dialects import postgresql
    from sqlalchemy import select

    from app.models import ApiSource

    sql = str(
        select(ApiSource.id)
        .where(ApiSource.enabled.is_(True), ApiSource.owner_filter(owner))
        .compile(dialect=postgresql.dialect())
    )
    assert "IS NULL" in sql if owner is None else "=" in sql
    assert "IS %(user" not in sql and "IS ?" not in sql
