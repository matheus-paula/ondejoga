"""Ambiente de teste da API OndeJoga.

Regras do ambiente de teste (definidas *antes* de importar a aplicação):
- banco SQLite em arquivo temporário (nenhuma dependência de PostgreSQL);
- rede bloqueada (`ALLOW_NETWORK=0`): nenhum teste depende de internet;
- cache do dashboard desligado para testes sempre verem dados "frescos".
"""
from __future__ import annotations

import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="ondejoga-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["ALLOW_NETWORK"] = "0"
os.environ["DASHBOARD_CACHE_TTL"] = "0"
os.environ["DEFAULT_CACHE_TTL"] = "300"
# Versão sem git por perto: sem isto o teste rodaria lendo o repositório real
# (ou o `/ondejoga` do container) e o resultado dependeria de onde roda.
os.environ["APP_REPO_DIR"] = str(_TMP / "no-repo")
os.environ["CORS_ORIGINS"] = "*"
# Arquivos de reset de senha (RESET-<usuario>.txt) saem para uma pasta temporária.
os.environ["RESET_DIR"] = str(_TMP / "resets")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import reset_settings_cache  # noqa: E402

reset_settings_cache()

from app import db as app_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ApiSource, Setting, User, UserSession  # noqa: E402
from app.services.cache import cache  # noqa: E402
from app.services.resolver import clear_runtime_status  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema() -> None:
    app_db.init_db()


@pytest.fixture(scope="session")
def client() -> TestClient:
    """Cliente de teste; o `with` dispara o lifespan (init + seed)."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def db():
    """Sessão SQLAlchemy isolada para testes de serviço/provedor."""
    session = app_db.get_sessionmaker()()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _clean_database() -> None:
    session = app_db.get_sessionmaker()()
    try:
        for model in (UserSession, User, ApiSource, Setting):
            session.query(model).delete()
        session.commit()
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _isolate():
    """Limpa cache, status em memória e banco entre cada teste."""
    cache.clear()
    clear_runtime_status()
    yield
    cache.clear()
    clear_runtime_status()
    _clean_database()


@pytest.fixture()
def auth_client(client: TestClient) -> TestClient:
    """Cliente já logado numa conta (testes que gravam config/fontes)."""
    client.post(
        "/api/auth/register",
        json={"username": "tester", "password": "segredo123"},
    )
    yield client
    client.post("/api/auth/logout")
