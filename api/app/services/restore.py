"""Restaura a configuração de um usuário ao padrão, sem tocar na conta.

O painel acumula estado que pode quebrar sozinho com o tempo: fonte remapeada
errado no CRUD, widget que sumiu do layout, fuso ou tema trocados sem querer.
Em vez de obrigar a pessoa a desfazer tudo item por item, ela escolhe o que
quer zerar e o app volta ao estado de fábrica daquele item.

`users` e `user_sessions` ficam de fora sempre: restaurar muda configuração,
não identidade — a conta, a senha e a sessão aberta continuam valendo.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ApiSource, User
from ..seed import seed_sources
from . import store
from .cache import cache
from .resolver import clear_runtime_status

# O que pode ser zerado. O schema da API valida a lista contra os mesmos nomes.
RESTORABLE_ITEMS = ("sources", "layout", "config")


def _reset_sources(db: Session, user: User) -> int:
    """Apaga as fontes do escopo da conta e recria as originais de fábrica.

    Só o escopo do usuário é mexido: as fontes globais (visitante anônimo) são
    de todo mundo e não são culpa dele.
    """
    rows = list(db.scalars(select(ApiSource).where(ApiSource.owner_filter(user.id))))
    removed = len(rows)
    for row in rows:
        db.delete(row)
    db.commit()
    seed_sources(db, user_id=user.id)
    return removed


def restore(db: Session, user: User, items: list[str]) -> dict:
    """Zera os itens pedidos e devolve o que foi feito."""
    requested = [item for item in RESTORABLE_ITEMS if item in set(items)]
    result: dict[str, object] = {"reset": requested, "sources_count": 0}

    if "sources" in requested:
        result["sources_count"] = _reset_sources(db, user)
    if "layout" in requested:
        store.reset_layout(db, user_id=user.id)
    if "config" in requested:
        store.reset_config(db, user.id)
        # O time também sai do registro da conta, senão o painel monta com o
        # time velho enquanto a pessoa ainda nem escolheu o novo.
        user.team_name = ""
        db.commit()

    if requested:
        # Resolvedor e status guardam dados das fontes antigas: sem limpar,
        # a tela continuaria mostrando o que veio delas.
        cache.clear()
        clear_runtime_status()
    return result
