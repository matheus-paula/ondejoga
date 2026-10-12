"""Modelos ORM: contas de usuário + configuração (layout) + registro de APIs.

Todo dado de configuração é **por usuário**: `user_id = NULL` representa o
escopo global (padrões do app, usado por visitantes anônimos).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    """Conta simples: login + senha (PBKDF2) para ter um time particular."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    team_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserSession(Base):
    """Sessão autenticada (token guardado como hash; cookie httpOnly no cliente)."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class Setting(Base):
    """Chave/valor das configurações (config do time, layout dos cards).

    O dono é codificado na própria chave para não precisar de PK composta:
    `"config"` = escopo global (padrões do app / visitante anônimo) e
    `"config:u<id>"` = configuração particular de um usuário.
    """

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class ApiSource(Base):
    """Registro de uma API/fonte de dados usada pelo dashboard (CRUD).

    `user_id = NULL` = fonte global (padrão do app); caso contrário é particular
    de uma conta — cada usuário pode mapear as próprias fontes.
    """

    __tablename__ = "api_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    capabilities: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    base_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    headers: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    endpoints: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    mapping: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    cache_ttl_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    last_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    @staticmethod
    def owner_filter(user_id: int | None):
        """Filtro de escopo: `IS NULL` no global, `=` no escopo do usuário.

        `IS` com valor não-nulo não existe em PostgreSQL, então os dois casos
        precisam de operadores diferentes.
        """
        col = ApiSource.__table__.c.user_id
        return col.is_(None) if user_id is None else col == user_id
