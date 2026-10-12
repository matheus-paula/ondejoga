"""Adapter genérico: qualquer API REST + mapping declarativo.

É o que dá flexibilidade ao CRUD de APIs: você informa a URL, os endpoints
e *como* o JSON retornado se mapeia para cada informação que a tela precisa.
"""
from __future__ import annotations

from typing import Any

from .base import Provider, ProviderContext, ProviderError
from .mapping import normalize_mapping


class UrlJsonProvider(Provider):
    kind = "url_json"

    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        spec = (self.source.mapping or {}).get(capability)
        if not isinstance(spec, dict) or "fields" not in spec:
            raise ProviderError(
                f"fonte '{self.source.name}' sem 'mapping.{capability}.fields'"
            )
        raw = self.fetch_json(capability, ctx)
        try:
            return normalize_mapping(
                raw,
                spec,
                capability,
                highlight_team_id=ctx.team_id,
                season=ctx.season,
                finished=capability == "last_match",
                source_name=self.source.name,
                now=ctx.now,
            )
        except (ValueError, TypeError, KeyError) as exc:
            raise ProviderError(f"mapping inválido em '{self.source.name}': {exc}") from exc
