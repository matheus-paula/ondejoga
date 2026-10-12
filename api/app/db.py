"""Sessões do banco de dados.

Usa PostgreSQL em produção (docker compose) e SQLite nos testes, via `DATABASE_URL`.
"""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None


def _build_engine(url: str) -> Engine:
    kwargs: dict = {"pool_pre_ping": True, "future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        _engine = _build_engine(get_settings()["database_url"])
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> sessionmaker:
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db():
    """Dependência FastAPI."""
    session: Session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    """Cria as tabelas (idempotente) e aplica migrações leves de coluna."""
    from . import models  # noqa: F401  (registro dos modelos)

    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _migrate(engine)


# Migrações "ADD COLUMN se faltar" — volumes já existentes continuam válidos.
_MIGRATIONS: tuple[tuple[str, str, str], ...] = (
    ("api_sources", "user_id", "ALTER TABLE api_sources ADD COLUMN user_id INTEGER"),
)

# A v1 tinha `api_sources.name` único no mundo inteiro. Com contas, o mesmo
# nome pode existir por usuário, então a unicidade passa para (escopo, nome).
# O índice funcional usa 0 como "escopo global" porque NULL não colide em SQL.
_SOURCE_SCOPE_DDL: dict[str, tuple[str, ...]] = {
    "postgresql": (
        "ALTER TABLE api_sources DROP CONSTRAINT IF EXISTS api_sources_name_key",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_api_sources_scope_name "
        "ON api_sources (COALESCE(user_id, 0), name)",
    ),
    "sqlite": (
        # SQLite não tem DROP CONSTRAINT; como nasce sem a restrição antiga,
        # só garantimos o índice composto.
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_api_sources_scope_name "
        "ON api_sources (COALESCE(user_id, 0), name)",
    ),
}


def _migrate(engine: Engine) -> None:
    import warnings

    from sqlalchemy import inspect, text

    with warnings.catch_warnings():  # SQLite não reflete índice expressional
        warnings.simplefilter("ignore")
        inspector = inspect(engine)
        for table, column, ddl in _MIGRATIONS:
            if table not in inspector.get_table_names():
                continue
            existing = {col["name"] for col in inspector.get_columns(table)}
            if column in existing:
                continue
            with engine.begin() as conn:
                conn.execute(text(ddl))
            inspector = inspect(engine)
        tables = inspector.get_table_names()

    if "api_sources" in tables:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            indexes = {ix["name"] for ix in inspect(engine).get_indexes("api_sources")}
        if "ix_api_sources_scope_name" not in indexes:
            for ddl in _SOURCE_SCOPE_DDL.get(engine.dialect.name, ()):
                with engine.begin() as conn:
                    conn.execute(text(ddl))


def reset_engine() -> None:
    """Usado pelos testes para trocar o `DATABASE_URL`."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
