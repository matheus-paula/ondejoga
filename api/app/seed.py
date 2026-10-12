"""Seed das fontes de dados padrão (roda só se o escopo estiver sem fontes)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ApiSource

WIKIPEDIA_ENDPOINTS = {
    "standings": "?action=parse&page={page_title}&prop=text&format=json&formatversion=2",
}

THESPORTSDB_ENDPOINTS = {
    "team": "lookupteam.php?id={team_id}",
    "standings": "lookuptable.php?l={competition_id}&s={season}",
    "next_match": "eventsnext.php?id={team_id}",
    "last_match": "eventslast.php?id={team_id}",
    "tv": "eventstv.php?id={event_id}",
}

ESPN_ENDPOINTS = {
    "team": "teams/{team_id}",
    "teams": "teams",
    "schedule": "teams/{team_id}/schedule?seasontype=1",
    "last_match": "teams/{team_id}/schedule?seasontype=1",
    "stats": "teams/{team_id}/schedule?seasontype=1",
    "next_match": (
        "https://sports.core.api.espn.com/v2/sports/soccer/leagues/{league}"
        "/teams/{team_id}/events?season={year}"
    ),
    "summary": "summary?event={event_id}",
    "broadcasts": "scoreboard?dates={date}",
    "live_match": "scoreboard?dates={date}",
}

RSS_ENDPOINTS = {
    "news": "rss/search?q={query}&hl=pt-BR&gl=BR&ceid=BR:pt-419",
}

DEFAULT_SOURCES: list[dict] = [
    {
        "name": "TheSportsDB",
        "kind": "thesportsdb",
        "enabled": True,
        "priority": 10,
        "capabilities": ["team", "next_match", "last_match"],
        "base_url": "https://www.thesportsdb.com/api/v1/json/{api_key}/",
        "api_key": "3",
        "headers": {},
        "endpoints": THESPORTSDB_ENDPOINTS,
        "mapping": {},
        "cache_ttl_seconds": 600,
        "timeout_seconds": 8,
        "notes": (
            "Gratuita (chave de teste '3'). Entrega time, próximos/jogos e TV. "
            "A tabela de classificação grátis vem limitada a 5 linhas — por isso "
            "a classificação fica com a Wikipédia."
        ),
    },
    {
        "name": "ESPN",
        "kind": "espn",
        "enabled": True,
        "priority": 20,
        "capabilities": ["team", "teams", "next_match", "last_match", "stats", "broadcasts",
                         "live_match"],
        "base_url": "https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/",
        "api_key": None,
        "headers": {},
        "endpoints": ESPN_ENDPOINTS,
        "mapping": {},
        "cache_ttl_seconds": 600,
        "timeout_seconds": 8,
        "notes": (
            "Sem chave. Usada para calendário/resultados, estatísticas da temporada "
            "(calculadas do histórico de jogos) e para as escudos dos times."
        ),
    },
    {
        "name": "Wikipédia",
        "kind": "wikipedia",
        "enabled": True,
        "priority": 30,
        "capabilities": ["standings"],
        "base_url": "https://pt.wikipedia.org/w/api.php",
        "api_key": None,
        "headers": {},
        "endpoints": WIKIPEDIA_ENDPOINTS,
        "mapping": {"standings": {"columns": None}},
        "cache_ttl_seconds": 1800,
        "timeout_seconds": 12,
        "notes": (
            "Tabela completa sem chave. A página é configurada por campeonato no "
            "campo 'page' de cada competição em /api/config (aceita {season})."
        ),
    },
    {
        "name": "Google Notícias (RSS)",
        "kind": "rss",
        "enabled": True,
        "priority": 40,
        "capabilities": ["news"],
        "base_url": "https://news.google.com/",
        "api_key": None,
        "headers": {},
        "endpoints": RSS_ENDPOINTS,
        "mapping": {},
        "cache_ttl_seconds": 900,
        "timeout_seconds": 10,
        "notes": "Busca no Google Notícias pelo nome do time ({query}). Substitua por qualquer RSS.",
    },
    {
        "name": "TV padrão (estático)",
        "kind": "static_json",
        "enabled": True,
        "priority": 90,
        "capabilities": ["tv"],
        "base_url": "",
        "api_key": None,
        "headers": {},
        "endpoints": {},
        "mapping": {
            "tv": {
                "by_competition": {
                    "4351": [
                        {"name": "Premiere", "country": "BR"},
                        {"name": "SporTV", "country": "BR"},
                        {"name": "Globo", "country": "BR"},
                        {"name": "Zapping Sports", "country": "BR"},
                    ],
                    "4725": [
                        {"name": "Premiere", "country": "BR"},
                        {"name": "SporTV", "country": "BR"},
                        {"name": "Globo", "country": "BR"},
                    ],
                    "4501": [
                        {"name": "Paramount+", "country": "BR"},
                        {"name": "SporTV", "country": "BR"},
                        {"name": "ESPN Brasil", "country": "BR"},
                    ],
                    "default": [
                        {"name": "Premiere", "country": "BR"},
                        {"name": "SporTV", "country": "BR"},
                    ],
                }
            }
        },
        "cache_ttl_seconds": 86400,
        "timeout_seconds": 2,
        "notes": (
            "Lista de transmissoras por competição. Edite quando quiser — "
            "os dados são apenas o seu mapeamento, sem chamada externa."
        ),
    },
]


def _upgrade_defaults(db: Session, rows: list[ApiSource]) -> int:
    """Migração leve: acrescenta capacidades/endpoints novos às fontes padrão.

    Só completa o que falta (nunca sobrescreve o que o usuário editou), para que
    fontes já semeadas em instalações antigas ganhem recursos novos (ex.:
    `live_match`) sem perder a configuração manual.
    """
    defaults = {(p["name"], p["kind"]): p for p in DEFAULT_SOURCES}
    changed = 0
    for row in rows:
        payload = defaults.get((row.name, row.kind))
        if payload is None:
            continue
        caps = list(row.capabilities or [])
        missing = [c for c in payload["capabilities"] if c not in caps]
        endpoints = dict(row.endpoints or {})
        for cap, template in payload.get("endpoints", {}).items():
            if cap in missing and cap not in endpoints:
                endpoints[cap] = template
        if not missing:
            continue
        row.capabilities = caps + missing
        if endpoints != (row.endpoints or {}):
            row.endpoints = endpoints
        changed += 1
    if changed:
        db.commit()
    return changed


def seed_sources(db: Session, user_id: int | None = None) -> int:
    """Insere as fontes padrão apenas quando esse escopo não tem nenhuma.

    `user_id=None` = escopo global (visitante anônimo / app inteiro).
    Escopos já semeados recebem apenas as capacidades novas (ver `_upgrade_defaults`).
    """
    rows = list(
        db.scalars(
            select(ApiSource).where(ApiSource.owner_filter(user_id))
        ).all()
    )
    if not rows:
        for payload in DEFAULT_SOURCES:
            db.add(ApiSource(**payload, user_id=user_id))
        db.commit()
        return len(DEFAULT_SOURCES)
    _upgrade_defaults(db, rows)
    return 0


def upgrade_scopes(db: Session) -> int:
    """Migração de startup: completa capacidades novas em todos os escopos.

    `seed_sources` cuida do escopo que está sendo aberto; aqui garantimos que
    contas já existentes também ganhem os recursos novos (ex.: `live_match`).
    """
    owner_ids = list(db.scalars(select(ApiSource.user_id).distinct()).all())
    changed = 0
    for owner in owner_ids:
        rows = list(
            db.scalars(select(ApiSource).where(ApiSource.owner_filter(owner))).all()
        )
        changed += _upgrade_defaults(db, rows)
    return changed
