"""Autenticação simples: conta + sessão por cookie httpOnly.

Sem dependências externas: senha com PBKDF2-HMAC-SHA256 (stdlib) e sessão
identificada por token aleatório guardado no banco como hash SHA-256.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import ApiSource, User, UserSession, utcnow
from ..seed import seed_sources
from ..services.store import DEFAULT_LAYOUT, has_own_layout, save_layout

SESSION_TTL_DAYS = 30
COOKIE_NAME = "ondejoga_session"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")

PBKDF2_ITERATIONS = 260_000


class AuthError(Exception):
    """Erro de autenticação com mensagem pronta para o usuário."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# --------------------------------------------------------------------------- #
# Senhas
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256 com salt aleatório: `pbkdf2$<iter>$<salt>$<hash>`."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, AttributeError):
        return False


# --------------------------------------------------------------------------- #
# Contas
# --------------------------------------------------------------------------- #
def validate_username(username: str) -> str:
    username = (username or "").strip()
    if not USERNAME_RE.match(username):
        raise AuthError(
            "usuário deve ter 3 a 40 caracteres (letras, números, . _ -)", 422
        )
    return username


def validate_password(password: str) -> str:
    if not password or len(password) < 6:
        raise AuthError("a senha precisa de pelo menos 6 caracteres", 422)
    return password


def register_user(db: Session, username: str, password: str) -> User:
    username = validate_username(username)
    password = validate_password(password)
    exists = db.scalars(select(User).where(User.username == username)).first()
    if exists is not None:
        raise AuthError("já existe uma conta com esse usuário", 409)
    user = User(username=username, password_hash=hash_password(password), team_name="")
    db.add(user)
    db.commit()
    db.refresh(user)
    _seed_user_scope(db, user.id)
    return user


def authenticate(db: Session, username: str, password: str) -> User:
    user = db.scalars(select(User).where(User.username == (username or "").strip())).first()
    if user is None or not verify_password(password or "", user.password_hash):
        raise AuthError("usuário ou senha inválidos", 401)
    return user


def _seed_user_scope(db: Session, user_id: int) -> None:
    """Dá ao novo usuário o mesmo ponto de partida do app (fontes + layout)."""
    seed_sources(db, user_id=user_id)
    if not has_own_layout(db, user_id):
        save_layout(db, deepcopy(DEFAULT_LAYOUT), user_id=user_id)


# --------------------------------------------------------------------------- #
# Sessões
# --------------------------------------------------------------------------- #
def create_session(db: Session, user: User) -> str:
    """Cria a sessão e devolve o **token em claro** (o banco guarda só o hash)."""
    token = secrets.token_urlsafe(32)
    session = UserSession(
        token_hash=token_digest(token),
        user_id=user.id,
        expires_at=utcnow() + timedelta(days=SESSION_TTL_DAYS),
    )
    db.add(session)
    db.commit()
    return token


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_for_token(db: Session, token: str | None) -> User | None:
    """Usuário dono da sessão, ou None (anônimo/expirado)."""
    if not token:
        return None
    row = db.scalars(
        select(UserSession).where(UserSession.token_hash == token_digest(token))
    ).first()
    if row is None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < utcnow():
        db.delete(row)
        db.commit()
        return None
    return db.get(User, row.user_id)


def destroy_session(db: Session, token: str | None) -> None:
    if not token:
        return
    db.execute(delete(UserSession).where(UserSession.token_hash == token_digest(token)))
    db.commit()


def purge_expired(db: Session) -> int:
    """Limpa sessões vencidas (chamada no startup)."""
    result = db.execute(delete(UserSession).where(UserSession.expires_at < utcnow()))
    db.commit()
    return result.rowcount or 0


# --------------------------------------------------------------------------- #
# Escopo
# --------------------------------------------------------------------------- #
def seed_user_scope(db: Session, user_id: int | None) -> None:
    """Garante fontes/layout para o usuário (no-op para o escopo global)."""
    if user_id is None:
        return
    if db.scalars(
        select(ApiSource.id).where(ApiSource.user_id == user_id).limit(1)
    ).first() is None:
        seed_sources(db, user_id=user_id)
    if not has_own_layout(db, user_id):
        save_layout(db, deepcopy(DEFAULT_LAYOUT), user_id=user_id)


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "team_name": user.team_name or "",
    }
