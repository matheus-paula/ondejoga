"""Busca e resolução de times (onboarding e troca de time).

O registro exige escolher o time antes de usar o painel, e a mesma busca fica
disponível em Configurações para trocar depois.

Estratégia:
1. TheSportsDB (`searchteams.php` / `lookupteam.php`) — identidade do time
   (nome, escudo, cores, cidade) e a lista de competições que ele disputa.
2. ESPN (listagem de times da liga) — melhor esforço para descobrir o id do
   time nas capacidades que dependem dela (estatísticas e jogo ao vivo). Se a
   ESPN não tiver o time, o painel segue só com a TheSportsDB.

As URLs vêm do CRUD de fontes (capidade ``team``): se uma fonte morrer, o
usuário remapeia e a busca passa a usar o novo endereço.
"""
from __future__ import annotations

import unicodedata
from typing import Any

from ..labels import COMPETITION_NAMES_PT

import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import User
from . import store
from .cache import cache, cached
from .resolver import sources_for

DEFAULT_TSD_BASE = "https://www.thesportsdb.com/api/v1/json/3/"
DEFAULT_ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/"


class TeamsError(Exception):
    """Falha na busca/seleção de time com mensagem pronta para o usuário."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


# Nome da liga na TheSportsDB (minúsculas) -> slug do campeonato na ESPN.
ESPN_LEAGUES: dict[str, str] = {
    "brazilian serie a": "bra.1",
    "brazilian serie b": "bra.2",
    "english premier league": "eng.1",
    "premier league": "eng.1",
    "la liga": "esp.1",
    "serie a": "ita.1",
    "bundesliga": "ger.1",
    "french ligue 1": "fra.1",
    "uefa champions league": "uefa.champions",
}

# Competições com nome amigável + página da Wikipédia (as mesmas do DEFAULT).
# Ids da TheSportsDB. Sem `page` a competição não vira tabela, e aí não vira
# aba no painel — então qualquer campeonato que um time brasileiro jogue
# precisa estar aqui. A Wikipédia escreve "Sul-Americana"; a TSD, "Sudamericana".
# Os nomes vêm de `labels.COMPETITION_NAMES_PT`: é a mesma tabela que traduz a
# competição no payload do painel. Duas cópias aqui e ali seria questão de
# tempo até divergirem — e aí a busca dizia uma coisa e o painel outra.
KNOWN_COMPETITIONS: dict[str, dict[str, str]] = {
    "4351": {
        "name": COMPETITION_NAMES_PT["4351"],
        "kind": "league",
        "page": "Campeonato Brasileiro de Futebol de {season} - Série A",
    },
    "4404": {
        "name": COMPETITION_NAMES_PT["4404"],
        "kind": "league",
        "page": "Campeonato Brasileiro de Futebol de {season} - Série B",
    },
    "4625": {
        "name": COMPETITION_NAMES_PT["4625"],
        "kind": "league",
        "page": "Campeonato Brasileiro de Futebol de {season} - Série C",
    },
    "4725": {
        "name": COMPETITION_NAMES_PT["4725"],
        "kind": "cup",
        "page": "Copa do Brasil de Futebol de {season}",
    },
    "4501": {
        "name": COMPETITION_NAMES_PT["4501"],
        "kind": "league",
        # A página principal é a de grupos; o mata-mata fica em outra.
        "page": "Fase de grupos da Copa Libertadores da América de {season}",
        "knockout_page": "Fase final da Copa Libertadores da América de {season}",
    },
    "4724": {
        "name": COMPETITION_NAMES_PT["4724"],
        "kind": "league",
        # Mesma divisão da Libertadores: grupos numa página, mata-mata em outra.
        "page": "Fase de grupos da Copa Sul-Americana de {season}",
        "knockout_page": "Copa Sul-Americana de {season}",
    },
}


def _norm(value: str) -> str:
    """Minúsculas sem acentos e sem pontuação (comparação de nomes de times)."""
    decomposed = unicodedata.normalize("NFKD", value or "")
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return "".join(ch for ch in without_accents.lower() if ch.isalnum())


def _get_json(url: str, params: dict[str, str] | None = None) -> dict:
    """GET JSON com timeout/UA do app; qualquer falha vira `TeamsError`."""
    settings = get_settings()
    external = url.startswith(("http://", "https://"))
    if external and not settings.get("allow_network"):
        raise TeamsError("acesso externo desativado neste servidor (ALLOW_NETWORK=0)", 503)
    try:
        with httpx.Client(
            headers={"User-Agent": settings["user_agent"]},
            timeout=10,
            follow_redirects=True,
        ) as client:
            response = client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise TeamsError(f"falha de rede ao consultar a fonte de times: {exc}", 502) from exc
    if response.status_code != 200:
        raise TeamsError(f"a fonte de times respondeu HTTP {response.status_code}", 502)
    try:
        return response.json()
    except ValueError as exc:
        raise TeamsError("resposta inválida da fonte de times (JSON esperado)", 502) from exc


def _pick_base(
    db: Session,
    capability: str,
    kind: str,
    fallback: str,
    user_id: int | None,
    **fmt: str,
) -> str:
    """Base da fonte remapeável no CRUD (escopo do usuário, depois o global)."""
    scopes: tuple[int | None, ...] = ((user_id,) if user_id is not None else ()) + (None,)
    for scope in scopes:
        for source in sources_for(db, capability, scope):
            if source.kind != kind or not source.base_url:
                continue
            key = source.api_key or "3"
            try:
                return source.base_url.format(api_key=key, key=key, **fmt)
            except (KeyError, IndexError, ValueError):
                continue  # placeholder que não bate: tenta a próxima fonte
    return fallback.format(**fmt) if fmt else fallback


def search_teams(db: Session, query: str, user_id: int | None = None) -> list[dict[str, Any]]:
    """Sugere times pela TheSportsDB (somente futebol), no máximo 20."""
    query = (query or "").strip()
    if len(query) < 2:
        raise TeamsError("informe ao menos 2 letras para buscar o time", 422)
    base = _pick_base(db, "team", "thesportsdb", DEFAULT_TSD_BASE, user_id)

    def _load() -> list[dict[str, Any]]:
        data = _get_json(base + "searchteams.php", {"t": query})
        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        for team in data.get("teams") or []:
            if str(team.get("strSport") or "").lower() != "soccer":
                continue
            team_id = str(team.get("idTeam") or "")
            if not team_id or team_id in seen:
                continue
            seen.add(team_id)
            results.append(
                {
                    "provider": "thesportsdb",
                    "id": team_id,
                    "name": team.get("strTeam") or "",
                    "short_name": team.get("strTeamShort") or team.get("strTeam") or "",
                    "logo": team.get("strBadge") or None,
                    "country": team.get("strCountry") or None,
                    "league": team.get("strLeague") or None,
                }
            )
            if len(results) >= 20:
                break
        return results

    value, _hit = cached(cache.make_key("teams:search", base, query.lower()), 120, _load)
    return value


def _espn_league(team: dict) -> str | None:
    """Slug da liga na ESPN a partir da liga principal (ou país no Brasil)."""
    name = str(team.get("strLeague") or "").strip().lower()
    if name in ESPN_LEAGUES:
        return ESPN_LEAGUES[name]
    country = str(team.get("strCountry") or "").strip().lower()
    if country in ("brazil", "brasil"):
        return "bra.1"
    return None


def _resolve_espn(
    db: Session, team: dict, user_id: int | None = None
) -> tuple[str | None, str | None, str | None]:
    """`(id, liga, cor)` na ESPN varrendo a lista de times da liga do time.

    Melhor esforço: a ESPN é opcional — qualquer falha devolve `id=None` e o
    dashboard continua funcionando com a TheSportsDB.
    """
    league = _espn_league(team)
    if not league:
        return None, None, None
    base = _pick_base(db, "team", "espn", DEFAULT_ESPN_BASE, user_id, league=league)

    def _load() -> dict:
        return _get_json(base + "teams")

    try:
        data, _hit = cached(cache.make_key("teams:espn", base), 600, _load)
    except TeamsError:
        return None, league, None

    target = _norm(str(team.get("strTeam") or ""))
    leagues = (data.get("sports") or [{}])[0].get("leagues") or [{}]
    for entry in leagues[0].get("teams") or []:
        candidate = entry.get("team") or entry
        name = _norm(str(candidate.get("displayName") or candidate.get("name") or ""))
        if not target or not name:
            continue
        exact = name == target
        contains = len(name) >= 4 and len(target) >= 4 and (name in target or target in name)
        if exact or contains:
            color = candidate.get("color")
            return (
                str(candidate.get("id") or "") or None,
                league,
                f"#{color}" if color else None,
            )
    return None, league, None


def competitions_for(team: dict) -> list[dict[str, Any]]:
    """Competições do time a partir dos slots `strLeagueN`/`idLeagueN` da TSD.

    Ligas conhecidas ganham nome amigável e página da Wikipédia; times do
    Brasil sempre têm a Copa do Brasil junto, mesmo quando a TSD só devolve a
    liga principal.
    """
    slots = [(1, str(team.get("idLeague") or ""), str(team.get("strLeague") or ""))]
    slots += [
        (index, str(team.get(f"idLeague{index}") or ""), str(team.get(f"strLeague{index}") or ""))
        for index in range(2, 7)
    ]

    competitions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _slot, league_id, league_name in slots:
        league_id = league_id.strip()
        league_name = league_name.strip()
        if not league_id or not league_id.isdigit() or not league_name or league_id in seen:
            continue
        seen.add(league_id)
        known = KNOWN_COMPETITIONS.get(league_id, {})
        entry: dict[str, Any] = {
            "id": league_id,
            "name": known.get("name") or league_name,
            "provider": "thesportsdb",
            "kind": known.get("kind") or "league",
        }
        if known.get("page"):
            entry["page"] = known["page"]
        if known.get("knockout_page"):
            entry["knockout_page"] = known["knockout_page"]
        competitions.append(entry)

    country = str(team.get("strCountry") or "").strip().lower()
    if country in ("brazil", "brasil") and "4725" not in seen:
        known = KNOWN_COMPETITIONS["4725"]
        competitions.append(
            {
                "id": "4725",
                "name": known["name"],
                "provider": "thesportsdb",
                "kind": known["kind"],
                "page": known["page"],
            }
        )
    return competitions


def _build_team(
    team: dict, espn_id: str | None, espn_league: str | None, espn_color: str | None
) -> dict[str, Any]:
    """Converte o registro da TSD em `TeamConfig` (com todos os `ids`).

    Todos os `ids` entram sempre (vazios quando desconhecidos) para o
    `deep_merge` do `save_config` limpar ids antigos de um time anterior.
    """
    name = str(team.get("strTeam") or "")
    return {
        "name": name,
        "short_name": str(team.get("strTeamShort") or name),
        "city": team.get("strLocation") or None,
        # A TSD não tem estado/UF — o campo fica livre para o usuário.
        "state": None,
        "primary_color": team.get("strColour1") or espn_color or "#0093EC",
        "secondary_color": team.get("strColour2") or "#FFFFFF",
        "logo": team.get("strBadge") or team.get("strLogo") or None,
        "ids": {
            "thesportsdb": str(team.get("idTeam") or ""),
            "espn": espn_id or "",
            "espn_league": espn_league or "",
            "football_data": "",
            "api_football": "",
        },
        "competitions": competitions_for(team),
    }


def fetch_team_config(db: Session, team_id: str, user_id: int | None = None) -> dict[str, Any]:
    """Look-up completo do time na TSD + melhor esforço na ESPN."""
    base = _pick_base(db, "team", "thesportsdb", DEFAULT_TSD_BASE, user_id)

    def _load() -> dict:
        return _get_json(base + "lookupteam.php", {"id": team_id})

    data, _hit = cached(cache.make_key("teams:lookup", base, str(team_id)), 300, _load)
    rows = data.get("teams") or []
    if not rows:
        raise TeamsError("time não encontrado na TheSportsDB", 404)
    team = rows[0]
    sport = str(team.get("strSport") or "").lower()
    if sport and sport != "soccer":
        raise TeamsError("esse registro não é um time de futebol", 422)
    espn_id, espn_league, espn_color = _resolve_espn(db, team, user_id)
    return _build_team(team, espn_id, espn_league, espn_color)


def set_user_team(
    db: Session, user: User, provider: str, team_id: str
) -> dict[str, Any]:
    """Salva o time escolhido na config particular do usuário.

    Trocar de time refaz a lista de competições; "trocar" para o mesmo time
    só atualiza a identidade (escudo/cores) e preserva as competições já
    personalizadas pelo usuário.
    """
    if provider != "thesportsdb":
        raise TeamsError(f"provedor de time desconhecido: {provider}", 422)

    current_team = (store.get_config(db, user_id=user.id).get("team") or {})
    same_team = str((current_team.get("ids") or {}).get("thesportsdb") or "") == str(team_id)
    team = fetch_team_config(db, team_id, user_id=user.id)
    if same_team:
        team["city"] = team.get("city") or current_team.get("city")
        team["state"] = team.get("state") or current_team.get("state")
        if current_team.get("competitions"):
            team["competitions"] = current_team["competitions"]

    config = store.save_config(db, {"team": team}, user_id=user.id)
    user.team_name = str(team.get("name") or "")
    db.commit()
    db.refresh(user)
    # O payload do painel fica cacheado por dono: trocar de time limpa o dele.
    cache.invalidate(f"dashboard:{user.id}")
    return config
