"""Testes do cache em memória e do armazenamento de config/layout."""
from __future__ import annotations

import pytest

from app.services.cache import TTLCache, cache, cached
from app.services.store import (
    DEFAULT_LAYOUT,
    deep_merge,
    get_config,
    get_layout,
    reset_layout,
    save_config,
    save_layout,
    visible_widgets,
)


# --------------------------------------------------------------------------- #
# Cache
# --------------------------------------------------------------------------- #
def test_cache_make_key_and_roundtrip() -> None:
    c = TTLCache()
    key = c.make_key("cap", 1, "espn", "stats", None)
    assert key == "cap|1|espn|stats|None"
    assert c.get(key) is None
    c.set(key, {"x": 1}, ttl=60)
    assert c.get(key) == {"x": 1}
    c.invalidate("cap|")
    assert c.get(key) is None


def test_cache_respects_ttl_and_keeps_stale_copy() -> None:
    c = TTLCache()
    c.set("k", "valor", ttl=0)  # expira imediatamente
    assert c.get("k") is None
    assert c.get("k", allow_stale=True) == "valor"


def test_cached_calls_loader_once_and_reports_hit() -> None:
    calls: list[int] = []

    def loader() -> str:
        calls.append(1)
        return "valor"

    assert cached("t", 60, loader) == ("valor", False)
    assert cached("t", 60, loader) == ("valor", True)
    assert len(calls) == 1


def test_cached_serves_stale_when_loader_fails() -> None:
    cache.set("stale", "antigo", ttl=0)

    def broken() -> str:
        raise RuntimeError("api morreu")

    value, hit = cached("stale", 60, broken)
    assert value == "antigo"
    assert hit is True


def test_cached_propagates_error_without_stale() -> None:
    def broken() -> str:
        raise RuntimeError("api morreu")

    with pytest.raises(RuntimeError):
        cached("inexistente", 60, broken)


# --------------------------------------------------------------------------- #
# Store: config do time
# --------------------------------------------------------------------------- #
def test_deep_merge_is_recursive_and_non_destructive() -> None:
    base = {"a": {"b": 1, "c": 2}, "d": 3}
    merged = deep_merge(base, {"a": {"c": 9}})
    assert merged == {"a": {"b": 1, "c": 9}, "d": 3}
    assert base == {"a": {"b": 1, "c": 2}, "d": 3}  # base intacta


def test_get_config_returns_cruzeiro_defaults(db) -> None:
    config = get_config(db)
    assert config["team"]["name"] == "Cruzeiro"
    assert config["team"]["ids"]["thesportsdb"] == "134294"
    assert config["team"]["ids"]["espn"] == "2022"
    assert [c["id"] for c in config["team"]["competitions"]][:2] == ["4351", "4725"]
    assert config["timezone"] == "America/Sao_Paulo"
    assert config["default_theme"] in {"system", "light", "dark"}


def test_save_config_merges_and_keeps_untouched_fields(db) -> None:
    save_config(db, {"team": {"name": "Fluminense"}})
    config = get_config(db)
    assert config["team"]["name"] == "Fluminense"
    assert config["team"]["ids"]["thesportsdb"] == "134294"  # preservado
    assert config["timezone"] == "America/Sao_Paulo"  # preservado


def test_save_config_rejects_invalid_theme(db) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        save_config(db, {"default_theme": "neon"})


# --------------------------------------------------------------------------- #
# Store: layout dos cards
# --------------------------------------------------------------------------- #
def test_default_layout_has_all_dashboard_widgets(db) -> None:
    layout = get_layout(db)
    types = {w["type"] for w in layout["widgets"]}
    assert {"my_team", "next_match", "last_match", "standings", "news"} <= types
    assert layout == DEFAULT_LAYOUT  # nada salvo ainda => padrão


def test_save_layout_rejects_duplicated_widget_ids(db) -> None:
    layout = get_layout(db)
    layout["widgets"].append(dict(layout["widgets"][0]))
    with pytest.raises(ValueError, match="duplicados"):
        save_layout(db, layout)


def test_reset_layout_restores_defaults(db) -> None:
    layout = get_layout(db)
    layout["widgets"][1]["visible"] = False
    layout["theme"]["default"] = "dark"
    save_layout(db, layout)

    reset = reset_layout(db)
    assert get_layout(db) == reset
    assert reset["theme"]["default"] == "system"
    assert all(w["visible"] for w in reset["widgets"])


def test_visible_widgets_filters_and_orders(db) -> None:
    layout = get_layout(db)
    layout["widgets"][1]["visible"] = False
    saved = save_layout(db, layout)

    widgets = visible_widgets(saved)
    assert all(w.visible for w in widgets)
    assert [w.id for w in widgets] != [w["id"] for w in saved["widgets"]]
    orders = [w.order for w in widgets]
    assert orders == sorted(orders)
