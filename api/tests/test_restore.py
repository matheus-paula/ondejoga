"""Testes do "restaurar" de Configurações (voltar ao padrão sem tocar na conta).

O ponto é o escopo: o reset mexe em configuração do usuário, nunca em
`users`/`user_sessions` — conta, senha e sessão aberta sobrevivem.
"""
from __future__ import annotations

from typing import get_args

import pytest
from sqlalchemy import select

from app.models import ApiSource, User
from app.schemas import KNOWN_CAPABILITIES, RestoreRequest
from app.seed import seed_sources
from app.services import store
from app.services.restore import RESTORABLE_ITEMS

PASSWORD = "segredo123"


@pytest.fixture()
def logged(client):
    """Cliente com conta recém-criada (escopo do usuário começa vazio)."""
    client.post("/api/auth/register", json={"username": "tester", "password": PASSWORD})
    yield client
    client.post("/api/auth/logout")


def _restore(client, items, password=PASSWORD):
    return client.post(
        "/api/config/restore", json={"current_password": password, "items": items}
    )


# --------------------------------------------------------------------------- #
# Portas de entrada
# --------------------------------------------------------------------------- #
def test_restore_requires_account(client) -> None:
    payload = client.post(
        "/api/config/restore", json={"current_password": PASSWORD, "items": ["layout"]}
    )
    assert payload.status_code == 401


def test_restore_refuses_wrong_password(logged) -> None:
    payload = _restore(logged, ["layout"], password="outra-senha")
    assert payload.status_code == 401
    assert "senha" in payload.json()["detail"]


def test_restore_rejects_empty_selection(logged) -> None:
    assert _restore(logged, []).status_code == 422


def test_restore_rejects_unknown_item(logged) -> None:
    assert _restore(logged, ["conta"]).status_code == 422


def test_schema_and_restore_agree_on_the_item_names() -> None:
    """Se um item entrar no schema e não no serviço, a API aceita e não faz nada.

    Duas listas com os mesmos nomes, então o teste é o que impede uma de fugir
    da outra.
    """
    declared = RestoreRequest.model_fields["items"].annotation  # list[Literal[...]]
    allowed = set(get_args(get_args(declared)[0]))
    assert allowed == set(RESTORABLE_ITEMS)


# --------------------------------------------------------------------------- #
# Cada item isolado
# --------------------------------------------------------------------------- #
def test_layout_reset_restores_default_widgets(logged) -> None:
    layout = logged.get("/api/layout").json()
    layout["widgets"][0]["title"] = "Card Renomeado"
    assert logged.put("/api/layout", json=layout).status_code == 200

    payload = _restore(logged, ["layout"]).json()

    assert payload["reset"] == ["layout"]
    titles = [w["title"] for w in logged.get("/api/layout").json()["widgets"]]
    assert "Card Renomeado" not in titles
    assert "Meu Time" in titles


def test_sources_reset_recreates_factory_defaults(logged) -> None:
    # O registro já semeia o escopo do usuário com as fontes de fábrica.
    created = logged.post("/api/admin/sources", json={
        "name": "Fonte Quebrada",
        "kind": "url_json",
        "capabilities": ["news"],
        "base_url": "https://example.org/",
        "endpoints": {"news": "rss"},
    })
    assert created.status_code == 201
    before = logged.get("/api/admin/sources").json()
    assert "Fonte Quebrada" in {s["name"] for s in before}

    payload = _restore(logged, ["sources"]).json()

    assert payload["reset"] == ["sources"]
    assert payload["sources_count"] == len(before)  # o escopo inteiro foi apagado

    after = logged.get("/api/admin/sources").json()
    names = {s["name"] for s in after}
    assert "Fonte Quebrada" not in names
    assert {"JogosTV", "ESPN", "TheSportsDB"} <= names
    assert len(after) == len(before) - 1
    assert {s["kind"] for s in after} == {s["kind"] for s in before if s["name"] != "Fonte Quebrada"}


def test_config_reset_returns_to_defaults_and_owns_nothing(logged) -> None:
    logged.put("/api/config", json={"timezone": "Europe/Lisbon"})
    assert logged.get("/api/config").json()["owned"] is True

    payload = _restore(logged, ["config"]).json()

    assert payload["reset"] == ["config"]
    config = logged.get("/api/config").json()
    assert config["owned"] is False  # o portão de onboarding volta a pedir o time
    assert config["timezone"] == "America/Sao_Paulo"


def test_config_reset_also_clears_the_team_name(logged, db) -> None:
    user = db.query(User).filter_by(username="tester").one()
    user.team_name = "Cruzeiro"
    db.commit()
    assert logged.get("/api/auth/me").json()["user"]["team_name"] == "Cruzeiro"

    _restore(logged, ["config"])

    assert logged.get("/api/auth/me").json()["user"]["team_name"] == ""


# --------------------------------------------------------------------------- #
# Escopo e integridade
# --------------------------------------------------------------------------- #
def test_selection_is_additive(logged) -> None:
    layout = logged.get("/api/layout").json()
    layout["widgets"][0]["title"] = "Card Renomeado"
    logged.put("/api/layout", json=layout)
    logged.put("/api/config", json={"timezone": "Europe/Lisbon"})

    payload = _restore(logged, ["layout", "config"]).json()

    # itens voltam na ordem fixa do backend, não na ordem marcada
    assert payload["reset"] == ["layout", "config"]
    assert logged.get("/api/layout").json()["widgets"][0]["title"] != "Card Renomeado"
    assert logged.get("/api/config").json()["timezone"] == "America/Sao_Paulo"


def test_restore_keeps_account_and_current_session(logged) -> None:
    _restore(logged, ["sources", "layout", "config"])

    assert logged.get("/api/auth/me").json()["authenticated"] is True
    # a senha não mudou: dá para entrar de novo com a mesma
    again = logged.post(
        "/api/auth/login", json={"username": "tester", "password": PASSWORD}
    )
    assert again.status_code == 200


def test_restore_leaves_the_global_scope_alone(logged, db) -> None:
    seed_sources(db, user_id=None)  # fontes do visitante anônimo
    before = [row.id for row in db.scalars(select(ApiSource).where(ApiSource.owner_filter(None)))]
    assert before

    _restore(logged, ["sources"])

    db.expire_all()
    after = [row.id for row in db.scalars(select(ApiSource).where(ApiSource.owner_filter(None)))]
    assert after == before


def test_items_that_were_not_marked_stay_untouched(logged) -> None:
    layout = logged.get("/api/layout").json()
    layout["widgets"][0]["title"] = "Card Renomeado"
    logged.put("/api/layout", json=layout)
    logged.put("/api/config", json={"timezone": "Europe/Lisbon"})

    _restore(logged, ["sources"])

    assert logged.get("/api/layout").json()["widgets"][0]["title"] == "Card Renomeado"
    assert logged.get("/api/config").json()["timezone"] == "Europe/Lisbon"


def test_config_reset_removes_the_user_setting_row(logged, db) -> None:
    logged.put("/api/config", json={"timezone": "Europe/Lisbon"})
    user = db.query(User).filter_by(username="tester").one()
    assert store.has_own_config(db, user.id)

    _restore(logged, ["config"])

    assert not store.has_own_config(db, user.id)


def test_restored_scope_works_out_of_the_box(logged) -> None:
    """Restaurado, o escopo precisa funcionar sozinho — ninguém adicionando nada.

    Se um dia sair uma capacidade nova sem fonte de fábrica, é aqui que o
    teste reclama, e não o usuário descobrindo card em branco.
    """
    _restore(logged, ["sources"])

    sources = logged.get("/api/admin/sources").json()
    assert sources, "a restauração devia recriar as fontes de fábrica"
    assert all(s["enabled"] for s in sources)

    covered = {cap for s in sources for cap in s["capabilities"]}
    assert covered == set(KNOWN_CAPABILITIES)


def test_restored_scope_serves_every_capability_on_the_dashboard(logged) -> None:
    """Mesma garantia, mas do jeito que o painel enxerga: capacidade por capacidade."""
    _restore(logged, ["sources"])

    payload = logged.get("/api/admin/status").json()
    by_capability = {row["capability"]: row for row in payload["capabilities"]}

    assert set(by_capability) == set(KNOWN_CAPABILITIES)
    # toda capacidade tem fonte ativa escolhida — nenhuma fica esperando cadastro
    for capability, row in by_capability.items():
        assert row["active_source"], f"{capability} ficou sem fonte ativa"
