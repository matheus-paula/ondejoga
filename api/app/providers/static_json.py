"""Adapter de dados estáticos (JSON definido pelo usuário no CRUD).

Útil para informações que nenhuma API entrega — por exemplo, quais canais
transmitem cada competição.
"""
from __future__ import annotations

from typing import Any

from ..schemas import Broadcast, NewsItem
from .base import Provider, ProviderContext, ProviderError, as_str
from .mapping import record_to_broadcasts, records_to_news


class StaticJsonProvider(Provider):
    kind = "static_json"

    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        payload = (self.source.mapping or {}).get(capability)
        if payload is None:
            raise ProviderError(
                f"fonte estática '{self.source.name}' sem 'mapping.{capability}'"
            )
        if capability in ("tv", "broadcasts"):
            return self._broadcasts(payload, ctx)
        if capability == "news":
            items = payload.get("items") if isinstance(payload, dict) else payload
            news = records_to_news(items or [], self.source.name)
            if not news:
                raise ProviderError("fonte estática sem notícias")
            return news
        if capability == "team":
            if isinstance(payload, dict):
                return {
                    "id": as_str(payload.get("id")),
                    "name": payload.get("name") or ctx.team_name,
                    "short_name": payload.get("short_name") or payload.get("name"),
                    "logo": payload.get("logo"),
                    "city": payload.get("city"),
                    "stadium": payload.get("stadium"),
                }
        return payload

    @staticmethod
    def _broadcasts(payload: Any, ctx: ProviderContext) -> list[Broadcast]:
        entries: Any = payload
        if isinstance(payload, dict):
            by_comp = payload.get("by_competition") or payload
            entries = by_comp.get(str(ctx.primary_competition)) or by_comp.get("default") or []
        if isinstance(entries, dict):
            entries = [entries]
        if not isinstance(entries, list):
            raise ProviderError("mapping.tv deve ser lista ou {by_competition: {...}}")
        records = [e for e in entries if isinstance(e, dict)]
        result: list[Broadcast] = record_to_broadcasts(records)
        if not result:
            raise ProviderError("fonte estática sem canais")
        return result
