"""Adapter football-data.org v4 (requer token gratuito)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..schemas import FormResult, SeasonLine, SplitLine, StandingRow, Stats, TopScorer
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
    "team": "v4/teams/{team_id}",
    "standings": "v4/competitions/{competition_id}/standings",
    "next_match": "v4/teams/{team_id}/matches?status=SCHEDULED&limit=10",
    "last_match": "v4/teams/{team_id}/matches?status=FINISHED&limit=10",
    "stats": "v4/teams/{team_id}/matches?limit=80",
    "scorers": "v4/competitions/{competition_id}/scorers?team={team_id}&limit=10",
}


def _crest(team: dict) -> str | None:
    return team.get("crest") or team.get("logo")


def _match_from_fd(payload: dict, finished: bool, source_name: str) -> Any:
    score = payload.get("score") or {}
    full = score.get("fullTime") or {}
    competition = payload.get("competition") or {}
    return build_match(
        id_=payload.get("id"),
        competition=competition_ref(
            competition.get("id"), competition.get("name") or "Competição",
            competition.get("emblem"),
        ),
        kickoff=parse_dt(payload.get("utcDate")),
        finished_at=parse_dt(payload.get("utcDate")) if finished else None,
        home=team_ref(
            (payload.get("homeTeam") or {}).get("id"),
            (payload.get("homeTeam") or {}).get("name"),
            _crest(payload.get("homeTeam") or {}),
            full.get("home"),
        ),
        away=team_ref(
            (payload.get("awayTeam") or {}).get("id"),
            (payload.get("awayTeam") or {}).get("name"),
            _crest(payload.get("awayTeam") or {}),
            full.get("away"),
        ),
        status=payload.get("status"),
        round=(payload.get("stage") or payload.get("round")),
        venue=venue_ref(payload.get("venue")),
        source=source_name,
    )


class FootballDataProvider(Provider):
    kind = "football_data"
    DEFAULT_ENDPOINTS = DEFAULT_ENDPOINTS

    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        method = getattr(self, f"_fetch_{capability}", None)
        if method is None:
            raise ProviderError(f"capability '{capability}' não suportada por football_data")
        return method(ctx)

    def _fetch_team(self, ctx: ProviderContext) -> dict:
        data = self.fetch_json("team", ctx)
        if not data.get("id"):
            raise ProviderError("time não encontrado no football-data.org")
        address = data.get("address") or {}
        return {
            "id": as_str(data.get("id")),
            "name": data.get("name"),
            "short_name": data.get("shortName") or data.get("tla"),
            "logo": data.get("crest"),
            "city": address.get("locality"),
            "stadium": data.get("venue"),
        }

    def _fetch_standings(self, ctx: ProviderContext) -> list:
        data = self.fetch_json("standings", ctx)
        blocks = data.get("standings") or []
        tables = []
        for block in blocks:
            rows = []
            for rec in block.get("table") or []:
                team = rec.get("team") or {}
                rows.append(
                    StandingRow(
                        position=as_int(rec.get("position")),
                        team=team_ref(team.get("id"), team.get("name"), _crest(team)),
                        played=as_int(rec.get("played")),
                        won=as_int(rec.get("won")),
                        drawn=as_int(rec.get("draw")),
                        lost=as_int(rec.get("lost")),
                        goals_for=as_int(rec.get("goalsFor")),
                        goals_against=as_int(rec.get("goalsAgainst")),
                        goal_difference=as_int(rec.get("goalDifference")),
                        points=as_int(rec.get("points")),
                        form=as_str(rec.get("form")),
                        note=as_str(rec.get("description")),
                    )
                )
            comp = data.get("competition") or block.get("competition") or {}
            season = block.get("season") or data.get("season") or {}
            tables.append(
                make_table(
                    competition=competition_ref(
                        comp.get("id"), comp.get("name") or "Competição", comp.get("emblem")
                    ),
                    season=str(season.get("year") or season.get("startDate") or ctx.season),
                    rows=rows,
                    highlight_team_id=self.team_id(ctx),
                )
            )
        if not tables:
            raise ProviderError("sem classificação no football-data.org")
        return tables

    def _pick(self, data: dict, mode: str) -> dict:
        matches = data.get("matches") or []
        if not matches:
            raise ProviderError("nenhum jogo retornado")
        matches.sort(key=lambda m: m.get("utcDate") or "")
        if mode == "next":
            now = datetime.now(timezone.utc)
            future = [m for m in matches if parse_dt(m.get("utcDate")) and parse_dt(m["utcDate"]) >= now]
            return (future or matches)[0]
        return matches[-1] if mode == "last" else matches[0]

    def _fetch_next_match(self, ctx: ProviderContext):
        data = self.fetch_json("next_match", ctx)
        return _match_from_fd(self._pick(data, "next"), False, self.source.name)

    def _fetch_last_match(self, ctx: ProviderContext):
        data = self.fetch_json("last_match", ctx)
        return _match_from_fd(self._pick(data, "last"), True, self.source.name)

    def _fetch_stats(self, ctx: ProviderContext) -> Stats:
        data = self.fetch_json("stats", ctx)
        team_id = str(self.team_id(ctx))
        played = []
        for m in data.get("matches") or []:
            if m.get("status") not in ("FINISHED", "AWARDED"):
                continue
            full = ((m.get("score") or {}).get("fullTime") or {})
            home, away = m.get("homeTeam") or {}, m.get("awayTeam") or {}
            if full.get("home") is None or full.get("away") is None:
                continue
            is_home = str(home.get("id")) == team_id
            gf, ga = (full["home"], full["away"]) if is_home else (full["away"], full["home"])
            played.append(
                {
                    "date": parse_dt(m.get("utcDate")),
                    "home": is_home,
                    "gf": gf,
                    "ga": ga,
                    "result": "W" if gf > ga else ("D" if gf == ga else "L"),
                    "opponent": (away if is_home else home).get("name"),
                    "competition": (m.get("competition") or {}).get("name"),
                    "id": m.get("id"),
                }
            )
        if not played:
            raise ProviderError("sem jogos finalizados")
        played.sort(key=lambda p: p["date"] or datetime(2000, 1, 1, tzinfo=timezone.utc))
        results = [p["result"] for p in played]
        gf_total = sum(p["gf"] for p in played)
        ga_total = sum(p["ga"] for p in played)

        def streak(pred) -> int:
            n = 0
            for r in reversed(results):
                if pred(r):
                    n += 1
                else:
                    break
            return n

        def split(is_home: bool) -> SplitLine:
            rows = [p for p in played if p["home"] is is_home]
            if not rows:
                return SplitLine()
            return SplitLine(
                played=len(rows),
                won=sum(1 for p in rows if p["result"] == "W"),
                drawn=sum(1 for p in rows if p["result"] == "D"),
                lost=sum(1 for p in rows if p["result"] == "L"),
                goals_for=sum(p["gf"] for p in rows),
                goals_against=sum(p["ga"] for p in rows),
            )

        recent = [
            FormResult(
                id=str(p["id"]),
                date=p["date"].date().isoformat() if p["date"] else None,
                opponent=p["opponent"],
                result=p["result"],
                score=f"{p['gf']}-{p['ga']}",
                venue="home" if p["home"] else "away",
                competition=p["competition"],
            )
            for p in reversed(played[-5:])
        ]
        return Stats(
            season=SeasonLine(
                competition=played[-1]["competition"],
                played=len(played),
                won=results.count("W"),
                drawn=results.count("D"),
                lost=results.count("L"),
                goals_for=gf_total,
                goals_against=ga_total,
                goal_difference=gf_total - ga_total,
                points=results.count("W") * 3 + results.count("D"),
                form="".join(results[-5:]),
            ),
            home=split(True),
            away=split(False),
            goals_scored=gf_total,
            goals_conceded=ga_total,
            clean_sheets=sum(1 for p in played if p["ga"] == 0),
            avg_goals_scored=round(gf_total / len(played), 2),
            avg_goals_conceded=round(ga_total / len(played), 2),
            unbeaten_streak=streak(lambda r: r in ("W", "D")),
            win_streak=streak(lambda r: r == "W"),
            goalless_draws=sum(1 for p in played if p["result"] == "D" and p["gf"] == 0),
            recent_form=recent,
            top_scorers=self._top_scorers(ctx),
        )

    def _top_scorers(self, ctx: ProviderContext) -> list[TopScorer]:
        try:
            data = self.fetch_json(
                "scorers",
                ctx,
                # endpoint padrão definido abaixo em DEFAULT_ENDPOINTS
            )
        except ProviderError:
            return []
        out: list[TopScorer] = []
        for item in data.get("scorers") or []:
            player = item.get("player") or {}
            out.append(
                TopScorer(
                    name=player.get("name") or "—",
                    goals=as_int(item.get("goals")),
                    assists=as_int(item.get("assists")),
                    matches=as_int(item.get("playedMatches")),
                )
            )
        return out
