"""Adapter TheSportsDB (gratuito, chave na URL) — fonte primária."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from ..schemas import Broadcast, FormResult, SeasonLine, StandingRow, Stats
from .base import (
    Provider,
    ProviderContext,
    ProviderError,
    as_int,
    as_str,
    build_match,
    competition_ref,
    make_table,
    parse_dt,
    team_ref,
    venue_ref,
)

DEFAULT_ENDPOINTS = {
    "team": "lookupteam.php?id={team_id}",
    "standings": "lookuptable.php?l={competition_id}&s={season}",
    "next_match": "eventsnext.php?id={team_id}",
    "last_match": "eventslast.php?id={team_id}",
    "tv": "eventstv.php?id={event_id}",
}


def _event_to_match(payload: dict[str, Any], source_name: str, is_finished: bool):
    home = team_ref(
        payload.get("idHomeTeam"),
        payload.get("strHomeTeam"),
        payload.get("strHomeTeamBadge"),
        payload.get("intHomeScore") if is_finished else None,
    )
    away = team_ref(
        payload.get("idAwayTeam"),
        payload.get("strAwayTeam"),
        payload.get("strAwayTeamBadge"),
        payload.get("intAwayScore") if is_finished else None,
    )
    kickoff = parse_dt(payload.get("strTimestamp"))
    if kickoff is None:
        date = as_str(payload.get("dateEvent"))
        time = as_str(payload.get("strTime")) or "00:00:00"
        kickoff = parse_dt(f"{date}T{time}" if date else None)
    competition = competition_ref(
        payload.get("idLeague"),
        payload.get("strLeague") or "Competição",
        payload.get("strLeagueBadge"),
    )
    venue = venue_ref(payload.get("strVenue"), payload.get("strCity"))
    status = as_str(payload.get("strStatus"))
    if is_finished and status in (None, "NS", "TBD"):
        status = "FT"
    finished_at = kickoff if is_finished else None
    return build_match(
        id_=payload.get("idEvent"),
        competition=competition,
        kickoff=kickoff,
        finished_at=finished_at,
        home=home,
        away=away,
        status=status,
        round=payload.get("intRound"),
        venue=venue,
        source=source_name,
    )


def _result_symbol(payload: dict, team_id: str) -> str | None:
    home_id = str(payload.get("idHomeTeam") or "")
    away_id = str(payload.get("idAwayTeam") or "")
    try:
        hs = as_int(payload.get("intHomeScore"), -1)
        aws = as_int(payload.get("intAwayScore"), -1)
    except Exception:  # pragma: no cover
        return None
    if hs < 0 or aws < 0:
        return None
    is_home = home_id == str(team_id)
    gf, ga = (hs, aws) if is_home else (aws, hs)
    if gf > ga:
        return "W"
    if gf == ga:
        return "D"
    return "L"


class TheSportsDBProvider(Provider):
    kind = "thesportsdb"
    DEFAULT_ENDPOINTS = DEFAULT_ENDPOINTS

    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        method = getattr(self, f"_fetch_{capability}", None)
        if method is None:
            raise ProviderError(f"capability '{capability}' não suportada por thesportsdb")
        return method(ctx)

    def _fetch_team(self, ctx: ProviderContext) -> dict:
        data = self.fetch_json("team", ctx)
        teams = data.get("teams") or []
        if not teams:
            raise ProviderError("time não encontrado na TheSportsDB")
        t = teams[0]
        return {
            "id": as_str(t.get("idTeam")),
            "name": t.get("strTeam"),
            "short_name": t.get("strTeamShort") or t.get("strTeam"),
            "logo": t.get("strBadge") or t.get("strTeamBanner"),
            "city": t.get("strLocation"),
            "stadium": t.get("strStadium"),
            "formed": t.get("intFormedYear"),
            "league": t.get("strLeague"),
        }

    def _fetch_standings(self, ctx: ProviderContext) -> list:
        competitions = ctx.all_competitions or [ctx.primary_competition]
        tables = []
        for comp_id in competitions:
            data = self.fetch_json("standings", ctx, competition_id=comp_id)
            rows_raw = data.get("table")
            if not rows_raw:
                continue
            rows: list[StandingRow] = []
            for raw in rows_raw:
                rows.append(
                    StandingRow(
                        position=as_int(raw.get("intRank")),
                        team=team_ref(
                            raw.get("idTeam"),
                            raw.get("strTeam"),
                            raw.get("strBadge"),
                        ),
                        played=as_int(raw.get("intPlayed")),
                        won=as_int(raw.get("intWin")),
                        drawn=as_int(raw.get("intDraw")),
                        lost=as_int(raw.get("intLoss")),
                        goals_for=as_int(raw.get("intGoalsFor")),
                        goals_against=as_int(raw.get("intGoalsAgainst")),
                        goal_difference=as_int(raw.get("intGoalDifference")),
                        points=as_int(raw.get("intPoints")),
                        form=as_str(raw.get("strForm")),
                        note=as_str(raw.get("strDescription")),
                    )
                )
            first = rows_raw[0]
            tables.append(
                make_table(
                    competition=competition_ref(
                        first.get("idLeague") or comp_id,
                        first.get("strLeague") or comp_id,
                        ctx.team.get("competitions_logo"),
                    ),
                    season=as_str(first.get("strSeason")),
                    rows=rows,
                    highlight_team_id=self.team_id(ctx),
                    updated_at=parse_dt(first.get("dateUpdated")),
                )
            )
        if not tables:
            raise ProviderError("nenhuma tabela retornada")
        return tables

    def _pick_next(self, events: list[dict], ctx: ProviderContext):
        """Primeiro jogo a partir de agora (com tolerância de 3h para jogos ao vivo)."""
        best = None
        best_dt = None
        for ev in events:
            kickoff = parse_dt(ev.get("strTimestamp"))
            if kickoff is None:
                continue
            if kickoff < ctx.now - timedelta(hours=3):
                continue
            if best is None or kickoff < best_dt:
                best, best_dt = ev, kickoff
        return best or (events[0] if events else None)

    def _fetch_next_match(self, ctx: ProviderContext):
        data = self.fetch_json("next_match", ctx)
        events = data.get("events") or []
        if not events:
            raise ProviderError("sem jogos futuros")
        chosen = self._pick_next(events, ctx)
        if chosen is None:
            raise ProviderError("sem jogos futuros")
        return _event_to_match(chosen, self.source.name, is_finished=False)

    def _fetch_last_match(self, ctx: ProviderContext):
        data = self.fetch_json("last_match", ctx)
        results = data.get("results") or []
        for raw in results:
            if raw.get("intHomeScore") is not None and raw.get("intAwayScore") is not None:
                return _event_to_match(raw, self.source.name, is_finished=True)
        raise ProviderError("nenhum jogo finalizado encontrado")

    def _fetch_tv(self, ctx: ProviderContext) -> list[Broadcast]:
        if not ctx.event_id:
            return []
        data = self.fetch_json("tv", ctx, event_id=ctx.event_id)
        items = data.get("tvevents") or data.get("tvevent") or []
        if isinstance(items, dict):
            items = [items]
        out: list[Broadcast] = []
        for item in items:
            b = _tv_item_to_broadcast(item)
            if b:
                out.append(b)
        return out

    def _fetch_stats(self, ctx: ProviderContext) -> Stats:
        """Estatísticas básicas derivadas dos últimos resultados + tabela."""
        data = self.fetch_json("last_match", ctx)
        results = data.get("results") or []
        team_id = self.team_id(ctx)
        recent: list[FormResult] = []
        symbols: list[str] = []
        for raw in results:
            sym = _result_symbol(raw, team_id)
            if sym is None:
                continue
            symbols.append(sym)
            hs = as_int(raw.get("intHomeScore"), 0)
            aws = as_int(raw.get("intAwayScore"), 0)
            is_home = str(raw.get("idHomeTeam")) == str(team_id)
            recent.append(
                FormResult(
                    id=as_str(raw.get("idEvent")),
                    date=as_str(raw.get("dateEvent")),
                    opponent=raw.get("strAwayTeam") if is_home else raw.get("strHomeTeam"),
                    result=sym,
                    score=f"{hs}-{aws}",
                    venue="home" if is_home else "away",
                    competition=raw.get("strLeague"),
                )
            )
        stats = Stats(recent_form=recent)
        stats.unbeaten_streak = _streak(symbols, lambda s: s in ("W", "D"))
        stats.win_streak = _streak(symbols, lambda s: s == "W")
        try:
            tables = self._fetch_standings(ctx)
        except ProviderError:
            tables = []
        if tables:
            rows = tables[0].rows
            for row in rows:
                if row.team.id and str(row.team.id) == str(team_id):
                    stats.season = _season_line(tables[0].competition.name, row)
                    break
        return stats


def _tv_item_to_broadcast(item: dict) -> Broadcast | None:
    name = item.get("strChannel") or item.get("name") or item.get("strEvent")
    if not name:
        return None
    return Broadcast(
        name=str(name),
        country=as_str(item.get("strCountry") or item.get("strArea") or "BR"),
        url=as_str(item.get("strWebsite") or item.get("strTwitter")),
        logo=as_str(item.get("strBadge") or item.get("strThumb")),
    )


def _streak(symbols: list[str], predicate) -> int:
    count = 0
    for sym in symbols:
        if predicate(sym):
            count += 1
        else:
            break
    return count


def _season_line(competition: str, row) -> SeasonLine:
    return SeasonLine(
        competition=competition,
        position=row.position,
        played=row.played,
        won=row.won,
        drawn=row.drawn,
        lost=row.lost,
        goals_for=row.goals_for,
        goals_against=row.goals_against,
        goal_difference=row.goal_difference,
        points=row.points,
        form=row.form,
    )
