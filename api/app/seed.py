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

JOGOSTV_ENDPOINTS = {
    "tv": "{page}",
}

# Página do JogosTV por competição (as mesmas ids usadas no resto do app).
JOGOSTV_PAGES = {
    "4351": "/jogos-do-brasileirao-serie-a",
    "4350": "/jogos-do-brasileirao-serie-b",
    "4328": "/jogos-do-brasileirao-serie-c",
    "4725": "/jogos-da-copa-do-brasil",
    "4501": "/jogos-da-copa-libertadores",
    "4503": "/jogos-da-copa-sudamericana",
    "default": "/jogos-do-brasileirao-serie-a",
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
        "name": "JogosTV",
        "kind": "jogostv",
        "enabled": True,
        "priority": 50,
        "capabilities": ["tv"],
        "base_url": "https://www.jogostv.com.br",
        "api_key": None,
        "headers": {},
        "endpoints": JOGOSTV_ENDPOINTS,
        "mapping": {"pages": JOGOSTV_PAGES},
        "cache_ttl_seconds": 3600,
        "timeout_seconds": 15,
        "notes": (
            "Grade real por jogo, lida do HTML do JogosTV (a única fonte "
            "gratuita que cobre o Brasileirão). A página de cada competição "
            "fica em 'mapping.pages'. Quando o jogo aparece sem transmissão "
            "confirmada, nada é exibido — sem chute e sem lista genérica."
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


def _disable_legacy_tv(db: Session, rows: list[ApiSource]) -> int:
    """Desliga a lista estática de TV que era a fonte padrão de transmissão.

    Ela repetia os mesmos canais para todos os jogos do campeonato — chute
    apresentado como dado real. A grade por jogo agora vem do JogosTV; a fonte
    antiga continua cadastrada (e editável), só desligada.
    """
    changed = 0
    for row in rows:
        if row.name != "TV padrão (estático)" or row.kind != "static_json":
            continue
        if not row.enabled:
            continue
        row.enabled = False
        changed += 1
    if changed:
        db.commit()
    return changed


def _ensure_capability_coverage(db: Session, rows: list[ApiSource],
                                user_id: int | None = None) -> int:
    """Cadastra a fonte padrão quando o escopo ficou sem nenhuma para a capacidade.

    `seed_sources` só semeia escopo vazio, então contas já em uso não ganhavam
    fonte nova: quando a lista estática de TV foi desligada, o escopo ficaria
    sem nada para `tv`. Entra só o padrão que cobre uma capacidade órfã, e
    nunca se o escopo já tiver uma fonte daquele `kind` — assim fonte que o
    usuário desligou ou renomeou não vira duplicata.
    """
    covered = {
        cap
        for row in rows
        if row.enabled
        for cap in (row.capabilities or [])
    }
    kinds = {row.kind for row in rows}
    added = 0
    for payload in DEFAULT_SOURCES:
        if not payload.get("enabled"):
            continue
        if payload["kind"] in kinds:
            continue
        if not [c for c in payload["capabilities"] if c not in covered]:
            continue
        db.add(ApiSource(**payload, user_id=user_id))
        covered.update(payload["capabilities"])
        kinds.add(payload["kind"])
        added += 1
    if added:
        db.commit()
    return added


def seed_sources(db: Session, user_id: int | None = None) -> int:
    """Insere as fontes padrão apenas quando esse escopo não tem nenhuma.

    `user_id=None` = escopo global (visitante anônimo / app inteiro).
    Escopo já semeado só recebe o que falta: capacidades novas, a fonte que
    cobre uma capacidade órfã e o desligamento da lista estática de TV.
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
    _disable_legacy_tv(db, rows)
    _ensure_capability_coverage(db, rows, user_id)
    return 0


def upgrade_scopes(db: Session) -> int:
    """Migração de startup: atualiza todos os escopos já existentes.

    `seed_sources` cuida do escopo que está sendo aberto; aqui as contas já
    cadastradas ganham capacidades novas (ex.: `live_match`), deixam a lista
    estática de TV desligada e recebem a fonte que cobre o que ficou órfão.
    """
    owner_ids = list(db.scalars(select(ApiSource.user_id).distinct()).all())
    changed = 0
    for owner in owner_ids:
        rows = list(
            db.scalars(select(ApiSource).where(ApiSource.owner_filter(owner))).all()
        )
        changed += _upgrade_defaults(db, rows)
        changed += _disable_legacy_tv(db, rows)
        changed += _ensure_capability_coverage(db, rows, owner)
    return changed
