"""Dados de backup (offline) — evita tela vazia quando todas as APIs caem.

`app/data/fallback.json` é gerado por `scripts/generate_fallback.py` com dados
reais das fontes. Pode ser editado à mão sem problema.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..providers.base import ProviderContext
from ..schemas import Match, NewsItem, StandingTable, Stats

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "fallback.json"


@lru_cache(maxsize=1)
def _raw() -> dict:
    if not DATA_FILE.exists():
        return {}
    try:
        payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def reload_fallback() -> None:
    _raw.cache_clear()


def load_fallback(capability: str, ctx: ProviderContext | None = None) -> Any:
    data = _raw()
    try:
        if capability == "next_match":
            payload = data.get("next_match")
            return Match.model_validate(payload) if payload else None
        if capability == "last_match":
            payload = data.get("last_match")
            return Match.model_validate(payload) if payload else None
        if capability == "standings":
            return [StandingTable.model_validate(t) for t in data.get("standings") or []]
        if capability == "news":
            return [NewsItem.model_validate(n) for n in data.get("news") or []]
        if capability == "stats":
            payload = data.get("stats")
            return Stats.model_validate(payload) if payload else None
        # `tv`/`broadcasts` ficam de fora de propósito: sem grade por jogo não
        # há como saber quem transmite, e um chute aqui apareceria na tela
        # como se fosse dado real. Sem backup = sem seção "Onde assistir".
        if capability == "team":
            payload = data.get("team")
            return payload if isinstance(payload, dict) else None
        if capability == "teams":
            payload = data.get("teams")
            return payload if isinstance(payload, list) else None
    except (TypeError, ValueError, KeyError):
        return None
    return None
