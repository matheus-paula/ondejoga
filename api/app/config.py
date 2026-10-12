"""Configuração da aplicação lida do ambiente (12-factor)."""
from __future__ import annotations

import os
from functools import lru_cache

APP_NAME = "OndeJoga API"
APP_VERSION = "1.0.0"

DEFAULT_DATABASE_URL = "postgresql+psycopg://ondejoga:ondejoga@db:5432/ondejoga"


def _bool(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


@lru_cache(maxsize=1)
def get_settings() -> dict:
    return {
        "database_url": os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL),
        "cors_origins": [
            o.strip()
            for o in os.getenv("CORS_ORIGINS", "*").split(",")
            if o.strip()
        ],
        # Permite desativar o acesso externo em testes/rede isolada.
        "allow_network": _bool("ALLOW_NETWORK", "1"),
        # TTL padrão quando a fonte não define um.
        "default_cache_ttl": int(os.getenv("DEFAULT_CACHE_TTL", "300")),
        # Cache do payload agregado (protege as APIs gratuitas).
        "dashboard_cache_ttl": int(os.getenv("DASHBOARD_CACHE_TTL", "60")),
        "user_agent": os.getenv(
            "USER_AGENT",
            "OndeJoga/1.0 (dashboard de time; +https://github.com/ondejoga)",
        ),
        # Cookie de sessão: ligue só atrás de HTTPS.
        "cookie_secure": _bool("COOKIE_SECURE", "0"),
        "version": APP_VERSION,
    }


def reset_settings_cache() -> None:
    get_settings.cache_clear()
