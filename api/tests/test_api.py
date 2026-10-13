"""Testes da API HTTP: config, layout, CRUD de fontes, status e dashboard.

Todos os testes rodam offline (`ALLOW_NETWORK=0`): o dashboard usa o arquivo
de backup `app/data/fallback.json` quando todas as fontes externas falham.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from app.services import resolver
from app.services.fallback import DATA_FILE


# --------------------------------------------------------------------------- #
# Geral / saúde
# --------------------------------------------------------------------------- #
def test_info_endpoint_lists_routes(client) -> None:
    payload = client.get("/api").json()
    assert payload["name"] == "OndeJoga API"
    assert "/api/dashboard" in payload["endpoints"]
    assert payload["docs"] == "/api/docs"


def test_openapi_docs_are_served_under_api(client) -> None:
    """Sob /api/ para atravessar o proxy do nginx com um único portal."""
    assert client.get("/api/docs").status_code == 200
    spec = client.get("/api/openapi.json").json()
    assert "/api/dashboard" in spec["paths"]
    assert "/api/admin/sources" in spec["paths"]


def test_health_reports_database(client) -> None:
    payload = client.get("/api/health").json()
    assert payload["status"] == "ok"
    assert payload["database"] == "up"


# --------------------------------------------------------------------------- #
# Configuração do time
# --------------------------------------------------------------------------- #
def test_get_config_returns_defaults(client) -> None:
    payload = client.get("/api/config").json()
    assert payload["team"]["name"] == "Cruzeiro"
    assert payload["team"]["primary_color"].startswith("#")


def test_put_config_merges_partial_payload(auth_client) -> None:
    response = auth_client.put("/api/config", json={"team": {"name": "Fluminense"}})
    assert response.status_code == 200
    payload = response.json()
    assert payload["team"]["name"] == "Fluminense"
    assert payload["team"]["ids"]["espn"] == "2022"  # preservado


def test_put_config_rejects_invalid_theme(client) -> None:
    response = client.put("/api/config", json={"default_theme": "neon"})
    assert response.status_code == 422


# --------------------------------------------------------------------------- #
# Layout dos cards
# --------------------------------------------------------------------------- #
def test_get_layout_returns_widgets(client) -> None:
    payload = client.get("/api/layout").json()
    assert {w["type"] for w in payload["widgets"]} >= {"next_match", "standings", "news"}
    assert payload["refresh_interval_seconds"] > 0


def test_put_layout_rejects_duplicated_widget_ids(auth_client) -> None:
    layout = auth_client.get("/api/layout").json()
    layout["widgets"].append(dict(layout["widgets"][0]))
    response = auth_client.put("/api/layout", json=layout)
    assert response.status_code == 422


def test_put_layout_persists_hide_and_theme(auth_client) -> None:
    layout = auth_client.get("/api/layout").json()
    layout["theme"]["default"] = "dark"
    layout["widgets"][0]["visible"] = False
    assert auth_client.put("/api/layout", json=layout).status_code == 200

    saved = auth_client.get("/api/layout").json()
    assert saved["theme"]["default"] == "dark"
    assert saved["widgets"][0]["visible"] is False


def test_layout_reset_restores_defaults(auth_client) -> None:
    layout = auth_client.get("/api/layout").json()
    layout["widgets"] = layout["widgets"][:2]
    auth_client.put("/api/layout", json=layout)

    payload = auth_client.post("/api/layout/reset").json()
    assert len(payload["widgets"]) >= 5
    assert all(w["visible"] for w in payload["widgets"])


# --------------------------------------------------------------------------- #
# CRUD das fontes de dados (APIs)
# --------------------------------------------------------------------------- #
def test_sources_are_seeded_on_first_use(client) -> None:
    names = [s["name"] for s in client.get("/api/admin/sources").json()]
    assert {"TheSportsDB", "ESPN", "Wikipédia", "Google Notícias (RSS)"} <= set(names)


def test_create_source_roundtrip(auth_client) -> None:
    payload = {
        "name": "API do clube",
        "kind": "url_json",
        "priority": 5,
        "capabilities": ["news"],
        "base_url": "https://clube.test/api/",
        "endpoints": {"news": "noticias.json"},
        "mapping": {"news": {"root": "items", "fields": {"title": "titulo"}}},
    }
    created = auth_client.post("/api/admin/sources", json=payload)
    assert created.status_code == 201
    source_id = created.json()["id"]

    listed = {s["id"]: s for s in auth_client.get("/api/admin/sources").json()}
    assert listed[source_id]["kind"] == "url_json"
    assert listed[source_id]["mapping"]["news"]["root"] == "items"

    updated = auth_client.put(
        f"/api/admin/sources/{source_id}", json={**payload, "priority": 60, "enabled": False}
    )
    assert updated.status_code == 200
    assert updated.json()["priority"] == 60
    assert updated.json()["enabled"] is False

    deleted = auth_client.delete(f"/api/admin/sources/{source_id}")
    assert deleted.status_code == 200
    names = [s["name"] for s in auth_client.get("/api/admin/sources").json()]
    assert "API do clube" not in names


def test_create_source_rejects_duplicates_and_invalid_payloads(auth_client) -> None:
    base = {
        "name": "Duplicada",
        "kind": "rss",
        "capabilities": ["news"],
        "base_url": "https://rss.test/",
        "endpoints": {"news": "feed.xml"},
    }
    assert auth_client.post("/api/admin/sources", json=base).status_code == 201
    assert auth_client.post("/api/admin/sources", json=base).status_code == 409

    assert auth_client.post(
        "/api/admin/sources", json={**base, "name": "X", "capabilities": ["voar"]}
    ).status_code == 422
    assert auth_client.post(
        "/api/admin/sources", json={**base, "name": "Y", "kind": "alienigena"}
    ).status_code == 422
    assert auth_client.post(
        "/api/admin/sources", json={**base, "name": "Z", "base_url": "ftp://x"}
    ).status_code == 422
    assert auth_client.post("/api/admin/sources", json={**base, "name": "W", "capabilities": []}).status_code == 422


def test_update_missing_source_returns_404(auth_client) -> None:
    assert auth_client.put("/api/admin/sources/99999", json={
        "name": "Nada", "kind": "rss", "capabilities": ["news"],
    }).status_code == 404
    assert auth_client.delete("/api/admin/sources/99999").status_code == 404


def _create_static_tv(client) -> dict:
    """A lista estática não vem mais no seed — cria na hora para testar o CRUD."""
    payload = client.post("/api/admin/sources", json={
        "name": "TV manual",
        "kind": "static_json",
        "capabilities": ["tv"],
        "mapping": {"tv": [{"name": "Premiere"}, {"name": "SporTV"}]},
    })
    assert payload.status_code == 201, payload.text
    return payload.json()


def test_test_source_runs_offline_for_static_json(auth_client) -> None:
    static = _create_static_tv(auth_client)

    payload = auth_client.post(
        "/api/admin/sources/test", json={"id": static["id"], "capability": "tv"}
    )
    body = payload.json()
    assert payload.status_code == 200
    assert body["ok"] is True
    assert {b["name"] for b in body["normalized"]} >= {"Premiere", "SporTV"}


def test_test_source_validates_capability(auth_client) -> None:
    static = _create_static_tv(auth_client)

    assert auth_client.post(
        "/api/admin/sources/test", json={"id": static["id"], "capability": "voar"}
    ).status_code == 422
    assert auth_client.post("/api/admin/sources/test", json={}).status_code == 422


def test_status_reports_capabilities_and_fallbacks(client) -> None:
    client.get("/api/admin/sources")  # garante o seed das fontes padrão
    client.get("/api/dashboard")  # força tentativa real de resolução
    payload = client.get("/api/admin/status").json()["capabilities"]
    by_capability = {c["capability"]: c for c in payload}

    assert {"next_match", "last_match", "standings", "news", "stats"} <= set(by_capability)
    assert by_capability["standings"]["active_source"] == "Wikipédia"
    assert by_capability["news"]["active_source"] == "Google Notícias (RSS)"
    assert by_capability["next_match"]["status"] in {"ok", "fallback", "error"}
    assert "ESPN" in by_capability["next_match"]["fallbacks_available"]


# --------------------------------------------------------------------------- #
# Dashboard (offline, com backup local)
# --------------------------------------------------------------------------- #
@pytest.fixture()
def seeded_client(client):
    """Cliente com as fontes padrão já semeadas."""
    client.get("/api/admin/sources")
    return client


@pytest.mark.skipif(not DATA_FILE.exists(), reason="app/data/fallback.json não gerado")
def test_dashboard_returns_full_payload(seeded_client) -> None:
    payload = seeded_client.get("/api/dashboard?refresh=true").json()
    assert set(payload) >= {
        "team", "next_match", "last_match", "standings", "news", "stats", "meta",
    }
    assert payload["team"]["name"] == "Cruzeiro"
    assert payload["meta"]["cached"] is False
    capabilities = {s["capability"] for s in payload["meta"]["sources"]}
    assert {"next_match", "last_match", "standings", "news", "stats"} <= capabilities


def _backup_next_match_is_upcoming() -> bool:
    """O snapshot envelhece sozinho: o jogo que ele guarda já pode ter passado.

    O resolvedor não devolve como "próximo jogo" nada que já foi disputado,
    então os testes do backup precisam saber se o horário do snapshot ainda é
    futuro — sem isso passariam a depender do relógio de cada máquina.
    """
    snapshot = json.loads(DATA_FILE.read_text(encoding="utf-8"))["next_match"]
    kickoff = datetime.fromisoformat(str(snapshot["kickoff"]).replace("Z", "+00:00"))
    return kickoff + resolver.MATCH_TOLERANCE >= datetime.now(timezone.utc)


@pytest.mark.skipif(not DATA_FILE.exists(), reason="app/data/fallback.json não gerado")
def test_last_match_from_backup_has_both_teams(seeded_client) -> None:
    payload = seeded_client.get("/api/dashboard?refresh=true").json()
    match = payload["last_match"]
    assert match["home"]["name"]
    assert match["away"]["name"]
    assert match["competition"]["name"]
    assert match["home"]["score"] is not None


@pytest.mark.skipif(not DATA_FILE.exists(), reason="app/data/fallback.json não gerado")
def test_next_match_from_backup_only_while_still_upcoming(seeded_client) -> None:
    payload = seeded_client.get("/api/dashboard?refresh=true").json()
    if _backup_next_match_is_upcoming():
        next_match = payload["next_match"]
        assert next_match["home"]["name"]
        assert next_match["away"]["name"]
        assert next_match["competition"]["name"]
    else:
        # jogo do snapshot já disputado: o card de "Próximo Jogo" fica vazio
        assert payload["next_match"] is None


@pytest.mark.skipif(not DATA_FILE.exists(), reason="app/data/fallback.json não gerado")
def test_standings_highlight_own_team(seeded_client) -> None:
    payload = seeded_client.get("/api/dashboard?refresh=true").json()
    table = payload["standings"][0]
    assert len(table["rows"]) >= 10
    own = [r for r in table["rows"] if r["team"]["name"] == "Cruzeiro"]
    assert own, "linha do Cruzeiro ausente"
    assert own[0]["team"]["id"] == "134294"  # id vindo da config
    assert own[0]["team"]["logo"]  # escudo vindo da config
    assert table["highlight_team_id"] == "134294"


@pytest.mark.skipif(not DATA_FILE.exists(), reason="app/data/fallback.json não gerado")
def test_news_items_are_canonical(seeded_client) -> None:
    payload = seeded_client.get("/api/news").json()
    assert payload
    first = payload[0]
    assert set(first) >= {"id", "title", "url", "published_at", "source"}


@pytest.mark.skipif(not DATA_FILE.exists(), reason="app/data/fallback.json não gerado")
def test_stats_position_is_enriched_from_standings(seeded_client) -> None:
    payload = seeded_client.get("/api/dashboard?refresh=true").json()
    season = payload["stats"]["season"]
    assert season["position"] is not None
    assert season["points"] is not None


@pytest.mark.skipif(not DATA_FILE.exists(), reason="app/data/fallback.json não gerado")
def test_next_match_endpoint_returns_match(seeded_client) -> None:
    response = seeded_client.get("/api/next-match")
    if _backup_next_match_is_upcoming():
        payload = response.json()
        assert payload["home"]["name"]
        assert payload["away"]["name"]
    else:
        # sem próximo jogo de verdade não há o que servir: 404, nunca um
        # jogo que já terminou
        assert response.status_code == 404


def test_dashboard_survives_when_backup_is_disabled(seeded_client, monkeypatch) -> None:
    monkeypatch.setattr(resolver, "load_fallback", lambda *a, **k: None)
    payload = seeded_client.get("/api/dashboard?refresh=true").json()
    assert payload["next_match"] is None
    assert any(s["status"] == "error" for s in payload["meta"]["sources"])
