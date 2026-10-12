"""Adapter API-Football v3 (requer chave gratuita de 100 requisições/dia)."""
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
    "team": "teams?id={team_id}",
    "standings": "standings?league={competition_id}&season={season}",
    "next_match": "fixtures?team={team_id}&next=10",
    "last_match": "fixtures?team={team_id}&last=10",
    "stats": "fixtures?team={team_id}&season={season}",
    "scorers": "players/topscorers?team={team_id}&season={season}",
}


def _fixture_to_match(payload: dict, finished: bool, source_name: str) -> Any:
    fixture = payload.get("fixture") or {}
    league = payload.get("league") or {}
    teams = payload.get("teams") or {}
    goals = payload.get("goals") or {}
    venue = fixture.get("venue") or {}
    return build_match(
        id_=fixture.get("id"),
        competition=competition_ref(
            league.get("id"), league.get("name") or "Competição", league.get("logo")
        ),
        kickoff=parse_dt(fixture.get("date")),
        finished_at=parse_dt(fixture.get("date")) if finished else None,
        home=team_ref(
            (teams.get("home") or {}).get("id"),
            (teams.get("home") or {}).get("name"),
            (teams.get("home") or {}).get("logo"),
            goals.get("home"),
        ),
        away=team_ref(
            (teams.get("away") or {}).get("id"),
            (teams.get("away") or {}).get("name"),
            (teams.get("away") or {}).get("logo"),
            goals.get("away"),
        ),
        status=((fixture.get("status") or {}).get("short")),
        round=league.get("round"),
        venue=venue_ref(venue.get("name"), venue.get("city")),
        source=source_name,
    )


class ApiFootballProvider(Provider):
    kind = "api_football"
    DEFAULT_ENDPOINTS = DEFAULT_ENDPOINTS

    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        method = getattr(self, f"_fetch_{capability}", None)
        if method is None:
            raise ProviderError(f"capability '{capability}' não suportada por api_football")
        return method(ctx)

    def _fetch_team(self, ctx: ProviderContext) -> dict:
        data = self.fetch_json("team", ctx)
        response = data.get("response") or []
        if not response:
            raise ProviderError("time não encontrado na API-Football")
        team = response[0].get("team") or {}
        return {
            "id": as_str(team.get("id")),
            "name": team.get("name"),
            "short_name": team.get("name"),
            "logo": team.get("logo"),
            "city": (response[0].get("venue") or {}).get("city"),
            "stadium": (response[0].get("venue") or {}).get("name"),
        }

    def _fetch_standings(self, ctx: ProviderContext) -> list:
        data = self.fetch_json("standings", ctx)
        response = data.get("response") or []
        tables = []
        for block in response:
            league = block.get("league") or {}
            for group in block.get("standings") or []:
                rows = []
                if isinstance(group, dict):
                    group_rows = group.get("table") or []
                else:
                    group_rows = group
                for rec in group_rows:
                    team = rec.get("team") or {}
                    rows.append(
                        StandingRow(
                            position=as_int(rec.get("rank")),
                            team=team_ref(team.get("id"), team.get("name"), team.get("logo")),
                            played=as_int(rec.get("played")),
                            won=as_int(rec.get("win")),
                            drawn=as_int(rec.get("draw")),
                            lost=as_int(rec.get("lose")),
                            goals_for=as_int(rec.get("goalsFor")),
                            goals_against=as_int(rec.get("goalsAgainst")),
                            goal_difference=as_int(rec.get("goalsDiff")),
                            points=as_int(rec.get("points")),
                            form=as_str(rec.get("form")),
                        )
                    )
                if rows:
                    tables.append(
                        make_table(
                            competition=competition_ref(
                                league.get("id"),
                                league.get("name") or "Competição",
                                league.get("logo"),
                            ),
                            season=str(league.get("season") or ctx.season),
                            rows=rows,
                            highlight_team_id=self.team_id(ctx),
                        )
                    )
        if not tables:
            raise ProviderError("sem classificação na API-Football")
        return tables

    def _fetch_next_match(self, ctx: ProviderContext):
        data = self.fetch_json("next_match", ctx)
        return self._pick(data, "next")

    def _fetch_last_match(self, ctx: ProviderContext):
        data = self.fetch_json("last_match", ctx)
        return self._pick(data, "last")

    def _pick(self, data: dict, mode: str):
        response = data.get("response") or []
        if not response:
            raise ProviderError("nenhum jogo retornado pela API-Football")
        response.sort(key=lambda f: ((f.get("fixture") or {}).get("date") or ""))
        if mode == "next":
            now = datetime.now(timezone.utc)
            future = [
                f
                for f in response
                if parse_dt((f.get("fixture") or {}).get("date"))
                and parse_dt((f["fixture"]["date"])) >= now
            ]
            chosen = (future or response)[0]
            return _fixture_to_match(chosen, False, self.source.name)
        chosen = response[-1]
        return _fixture_to_match(chosen, True, self.source.name)

    def _fetch_stats(self, ctx: ProviderContext) -> Stats:
        data = self.fetch_json("stats", ctx)
        team_id = str(self.team_id(ctx))
        played = []
        for f in data.get("response") or []:
            fixture = f.get("fixture") or {}
            status = ((fixture.get("status") or {}).get("short"))
            if status not in ("FT", "AET", "PEN"):
                continue
            teams = f.get("teams") or {}
            goals = f.get("goals") or {}
            if goals.get("home") is None or goals.get("away") is None:
                continue
            is_home = str((teams.get("home") or {}).get("id")) == team_id
            gf, ga = (goals["home"], goals["away"]) if is_home else (goals["away"], goals["home"])
            league = f.get("league") or {}
            played.append(
                {
                    "date": parse_dt(fixture.get("date")),
                    "home": is_home,
                    "gf": gf,
                    "ga": ga,
                    "result": "W" if gf > ga else ("D" if gf == ga else "L"),
                    "opponent": (teams.get("away") if is_home else teams.get("home") or {}).get("name"),
                    "competition": league.get("name"),
                    "id": fixture.get("id"),
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
            data = self.fetch_json("scorers", ctx)
        except ProviderError:
            return []
        out: list[TopScorer] = []
        for item in (data.get("response") or [])[:10]:
            player = item.get("player") or {}
            out.append(
                TopScorer(
                    name=player.get("name") or "—",
                    goals=as_int((item.get("statistics") or [{}])[0].get("goals") if item.get("statistics") else item.get("goals")),
                    assists=as_int((item.get("statistics") or [{}])[0].get("assists") if item.get("statistics") else item.get("assists")),
                    matches=as_int((item.get("statistics") or [{}])[0].get("games") if item.get("statistics") else None),
                )
            )
        return out
