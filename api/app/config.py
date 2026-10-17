"""Configuração da aplicação lida do ambiente (12-factor)."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

APP_NAME = "OndeJoga API"
# Número de release versionada. Muda quando se corta uma release, como as tags
# do Pi-hole; o commit exato que está de pé vem do git (`app.version`).
APP_VERSION = "1.1.0"

DEFAULT_DATABASE_URL = "postgresql+psycopg://ondejoga:ondejoga@db:5432/ondejoga"

# Raiz do projeto local (fora do container é a pasta do compose; no container a
# imagem tem o código em /app, então o compose define RESET_DIR explicitamente).
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


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
        # Por quanto tempo um payload expirado ainda pode ser entregue de
        # imediato, enquanto o refresco corre em segundo plano (stale-while-
        # revalidate). Além disso a tela volta a esperar a rede — dado muito
        # velho de futebol é pior que a espera.
        "dashboard_stale_seconds": int(os.getenv("DASHBOARD_STALE_SECONDS", "600")),
        "user_agent": os.getenv(
            "USER_AGENT",
            "OndeJoga/1.0 (dashboard de time; +https://github.com/ondejoga)",
        ),
        # Cookie de sessão: ligue só atrás de HTTPS.
        "cookie_secure": _bool("COOKIE_SECURE", "0"),
        # Raiz do volume do projeto: arquivos gerados (RESET-<usuario>.txt).
        "reset_dir": os.getenv("RESET_DIR") or str(_PROJECT_ROOT),
        "version": APP_VERSION,
    }


def reset_settings_cache() -> None:
    get_settings.cache_clear()
