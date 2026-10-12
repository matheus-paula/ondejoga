"""Registro de adapters por `kind`."""
from __future__ import annotations

from .api_football import ApiFootballProvider
from .base import Provider, ProviderContext, ProviderError, SourceConfig
from .espn import ESPNProvider
from .football_data import FootballDataProvider
from .jogostv import JogoTVProvider
from .rss import RSSProvider
from .static_json import StaticJsonProvider
from .thesportsdb import TheSportsDBProvider
from .url_json import UrlJsonProvider
from .wikipedia import WikipediaProvider

PROVIDERS: dict[str, type[Provider]] = {
    "thesportsdb": TheSportsDBProvider,
    "espn": ESPNProvider,
    "rss": RSSProvider,
    "football_data": FootballDataProvider,
    "api_football": ApiFootballProvider,
    "url_json": UrlJsonProvider,
    "static_json": StaticJsonProvider,
    "wikipedia": WikipediaProvider,
    "jogostv": JogoTVProvider,
}

__all__ = [
    "PROVIDERS",
    "Provider",
    "ProviderContext",
    "ProviderError",
    "SourceConfig",
    "build_provider",
]


def build_provider(source: SourceConfig) -> Provider:
    cls = PROVIDERS.get(source.kind)
    if cls is None:
        raise ProviderError(f"kind desconhecido: '{source.kind}'")
    return cls(source)
