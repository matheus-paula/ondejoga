"""Persistência das configurações (config do time + layout dos cards).

Tudo é **por usuário**: `user_id=None` é o escopo global (padrões do app,
usado por visitantes anônimos). Um usuário logado enxerga e edita só o seu.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

from ..models import Setting
from ..schemas import AppConfig, Layout, WidgetConfig

CONFIG_KEY = "config"
LAYOUT_KEY = "layout"

DEFAULT_CONFIG: dict[str, Any] = {
    "team": {
        "name": "Cruzeiro",
        "short_name": "Cruzeiro",
        "city": "Belo Horizonte",
        "state": "MG",
        "primary_color": "#0093EC",
        "secondary_color": "#FFFFFF",
        "logo": "https://r2.thesportsdb.com/images/media/team/badge/upsvvu1473538059.png",
        "ids": {
            "thesportsdb": "134294",
            "espn": "2022",
            "espn_league": "bra.1",
            "football_data": "",
            "api_football": "135",
        },
        "competitions": [
            {
                "id": "4351",
                "name": "Brasileirão Série A",
                "provider": "thesportsdb",
                "kind": "league",
                "page": "Campeonato Brasileiro de Futebol de {season} - Série A",
            },
            {
                "id": "4725",
                "name": "Copa do Brasil",
                "provider": "thesportsdb",
                "kind": "cup",
                "page": "Copa do Brasil de Futebol de {season}",
            },
            {
                "id": "4501",
                "name": "Copa Libertadores",
                "provider": "thesportsdb",
                "kind": "league",
                # A página principal é a de grupos; o mata-mata fica em outra.
                "page": "Fase de grupos da Copa Libertadores da América de {season}",
                "knockout_page": "Fase final da Copa Libertadores da América de {season}",
            },
            {"id": "5763", "name": "Campeonato Mineiro", "provider": "thesportsdb",
             "kind": "league"},
        ],
    },
    "timezone": "America/Sao_Paulo",
    "locale": "pt-BR",
    "refresh_interval_seconds": 300,
    "default_theme": "system",
}

DEFAULT_LAYOUT: dict[str, Any] = {
    # accent "auto" = segue a cor do time selecionado
    "theme": {"default": "system", "accent": "auto"},
    "refresh_interval_seconds": 300,
    "widgets": [
        {
            "id": "live_match",
            "type": "live_match",
            "title": "Tempo Real",
            "visible": True,
            "order": -1,
            "size": "md",
            "options": {"show_status": True, "show_venue": True},
        },
        {
            "id": "my_team",
            "type": "my_team",
            "title": "Meu Time",
            "visible": True,
            "order": 0,
            "size": "lg",
            "options": {"show_top_scorers": True, "show_chart": True, "metrics": []},
        },
        {
            "id": "next_match",
            "type": "next_match",
            "title": "Próximo Jogo",
            "visible": True,
            "order": 1,
            "size": "md",
            "options": {"show_broadcasts": True, "show_countdown": True},
        },
        {
            "id": "last_match",
            "type": "last_match",
            "title": "Último Jogo",
            "visible": True,
            "order": 2,
            "size": "md",
            "options": {},
        },
        {
            "id": "standings",
            "type": "standings",
            "title": "Tabelas",
            "visible": True,
            "order": 3,
            "size": "lg",
            "options": {"max_rows": 20, "competitions": [], "hide_eliminated": True},
        },
        {
            "id": "news",
            "type": "news",
            "title": "Notícias",
            "visible": True,
            "order": 4,
            "size": "md",
            "options": {"limit": 6},
        },
        {
            "id": "form",
            "type": "form",
            "title": "Momento do Time",
            "visible": True,
            "order": 5,
            "size": "sm",
            "options": {"limit": 5},
        },
    ],
}


def deep_merge(base: dict, override: dict) -> dict:
    out = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _scoped_key(key: str, user_id: int | None) -> str:
    """Chave da configuração do dono (None = escopo global, sem sufixo)."""
    return f"{key}:u{int(user_id)}" if user_id is not None else key


def _load(db: Session, key: str, user_id: int | None = None) -> dict | None:
    row = db.get(Setting, _scoped_key(key, user_id))
    if row is None and user_id is not None:
        # herda do escopo global o que o usuário ainda não personalizou
        row = db.get(Setting, key)
    return dict(row.value) if row else None


def _save(db: Session, key: str, value: dict, user_id: int | None = None) -> None:
    scoped = _scoped_key(key, user_id)
    row = db.get(Setting, scoped)
    if row is None:
        row = Setting(key=scoped, value=value)
        db.add(row)
    else:
        row.value = value
    db.commit()


def get_config(db: Session, user_id: int | None = None) -> dict:
    """Config completa do usuário (herdando o que ele não sobrescreveu)."""
    stored = _load(db, CONFIG_KEY, user_id) or {}
    merged = deep_merge(DEFAULT_CONFIG, stored)
    AppConfig.model_validate(merged)  # garante forma válida
    return merged


def save_config(db: Session, payload: dict, user_id: int | None = None) -> dict:
    current = _own_config(db, user_id)
    merged = deep_merge(current, payload or {})
    AppConfig.model_validate(merged)
    _save(db, CONFIG_KEY, merged, user_id)
    return merged


def _own_config(db: Session, user_id: int | None) -> dict:
    """Config efetivamente editável pelo dono (sem herdar do global ao salvar)."""
    stored = db.get(Setting, _scoped_key(CONFIG_KEY, user_id))
    base = dict(stored.value) if stored else deepcopy(DEFAULT_CONFIG)
    return deep_merge(DEFAULT_CONFIG, base)


def config_payload(db: Session, user_id: int | None = None) -> dict:
    """Config + flag `owned` (o escopo já escolheu/salvou o time).

    `owned=false` significa que o usuário ainda herda a config global e, no
    onboarding, precisa escolher o próprio time.
    """
    value = get_config(db, user_id)
    if isinstance(value, dict):
        return {**value, "owned": has_own_config(db, user_id)}
    return value


def _merge_missing_widgets(layout: dict) -> dict:
    """Acrescenta widgets novos do padrão a layouts já gravados (upgrade).

    Instalações antigas não têm os widgets criados depois; eles entram no fim
    sem mexer na ordem/visibilidade que o usuário já personalizou.
    """
    widgets = layout.get("widgets")
    if not isinstance(widgets, list):
        return layout
    known = {w.get("id") for w in widgets if isinstance(w, dict)}
    missing = [deepcopy(w) for w in DEFAULT_LAYOUT["widgets"] if w["id"] not in known]
    if not missing:
        return layout
    kept = [w for w in widgets if isinstance(w, dict)]
    next_order = max([int(w.get("order") or 0) for w in kept] or [0])
    for widget in missing:
        next_order += 1
        widget["order"] = next_order
        kept.append(widget)
    return {**layout, "widgets": kept}


def get_layout(db: Session, user_id: int | None = None) -> dict:
    stored = _load(db, LAYOUT_KEY, user_id)
    if stored is None:
        return deepcopy(DEFAULT_LAYOUT)
    Layout.model_validate(stored)
    return _merge_missing_widgets(stored)


def layout_payload(db: Session, user_id: int | None = None) -> dict:
    """Layout + flag `owned` (o escopo tem layout gravado ou é o padrão)."""
    value = get_layout(db, user_id)
    if isinstance(value, dict):
        return {**value, "owned": has_own_layout(db, user_id)}
    return value


def save_layout(db: Session, payload: dict, user_id: int | None = None) -> dict:
    if not payload:  # criação inicial do escopo (seed) usa o layout padrão
        payload = deepcopy(DEFAULT_LAYOUT)
    layout = Layout.model_validate(payload)
    ids = [w.id for w in layout.widgets]
    if len(ids) != len(set(ids)):
        raise ValueError("ids de widgets duplicados")
    value = layout.model_dump(mode="json")
    _save(db, LAYOUT_KEY, value, user_id)
    return value


def reset_layout(db: Session, user_id: int | None = None) -> dict:
    value = deepcopy(DEFAULT_LAYOUT)
    _save(db, LAYOUT_KEY, value, user_id)
    return value


def reset_config(db: Session, user_id: int) -> None:
    """Apaga a config particular do usuário.

    Sem linha própria o escopo volta a herdar a global e `owned` vira falso —
    é isso que faz o portão de onboarding exigir o time de novo. Por isso
    "zerar o time" e "zerar as preferências" são a mesma operação: as duas
    moram nessa linha.
    """
    row = db.get(Setting, _scoped_key(CONFIG_KEY, user_id))
    if row is None:
        return
    db.delete(row)
    db.commit()


def has_own_layout(db: Session, user_id: int | None) -> bool:
    """True quando já existe layout gravado nesse escopo."""
    return db.get(Setting, _scoped_key(LAYOUT_KEY, user_id)) is not None


def has_own_config(db: Session, user_id: int | None) -> bool:
    """True quando o escopo já tem config própria (linha própria na tabela).

    Checagem **estrita** pela chave escopada: quem nunca escolheu o time herda
    a config global, mas não é dono de nada — é isso que o portão de
    onboarding usa para exigir a escolha do time.
    """
    return db.get(Setting, _scoped_key(CONFIG_KEY, user_id)) is not None


def visible_widgets(layout: dict) -> list[WidgetConfig]:
    widgets = [WidgetConfig.model_validate(w) for w in layout.get("widgets", [])]
    return sorted([w for w in widgets if w.visible], key=lambda w: w.order)
