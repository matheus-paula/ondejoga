"""Adapter ESPN (sem chave) — fonte secundária: calendário, resultados, estatísticas."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from ..schemas import (
    Broadcast,
    CompetitionRef,
    FormResult,
    SeasonLine,
    SplitLine,
    StandingRow,
    Stats,
)
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
    "standings": "standings?season={year}",
}


def _team_logo(team: dict) -> str | None:
    for logo in team.get("logos") or []:
        if logo.get("href"):
            return logo["href"]
    return None


def _match_from_summary(payload: dict, source_name: str) -> "Any":
    header = payload.get("header") or {}
    comps = (header.get("competitions") or [{}])[0]
    comp_date = parse_dt(comps.get("date"))
    venue = ((payload.get("gameInfo") or {}).get("venue") or {})
    competition = competition_ref(
        (header.get("league") or {}).get("id"),
        ((header.get("season") or {}).get("name") or "Competição").strip(),
    )
    home = away = None
    for c in comps.get("competitors") or []:
        team = c.get("team") or {}
        ref = team_ref(
            team.get("id"),
            team.get("displayName") or team.get("name"),
            _team_logo(team) or team.get("logo"),
            c.get("score"),
        )
        if c.get("homeAway") == "home":
            home = ref
        else:
            away = ref
    if home is None or away is None:
        raise ProviderError("summary sem competidores")
    status = ((comps.get("status") or {}).get("type") or {})
    return build_match(
        id_=comps.get("id") or header.get("id"),
        competition=competition,
        kickoff=comp_date,
        home=home,
        away=away,
        status=status.get("shortDetail") or status.get("description"),
        venue=venue_ref(venue.get("fullName"), (venue.get("address") or {}).get("city")),
        source=source_name,
    )


class ESPNProvider(Provider):
    kind = "espn"
    DEFAULT_ENDPOINTS = DEFAULT_ENDPOINTS

    # ------------------------------------------------------------------ #
    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        method = getattr(self, f"_fetch_{capability}", None)
        if method is None:
            raise ProviderError(f"capability '{capability}' não suportada por espn")
        return method(ctx)

    # -- time ------------------------------------------------------------ #
    def _fetch_team(self, ctx: ProviderContext) -> dict:
        data = self.fetch_json("team", ctx)
        team = data.get("team") or {}
        if not team.get("id"):
            raise ProviderError("time não encontrado na ESPN")
        return {
            "id": as_str(team.get("id")),
            "name": team.get("displayName") or team.get("name"),
            "short_name": team.get("shortDisplayName") or team.get("abbreviation"),
            "logo": _team_logo(team),
            "city": team.get("location"),
            "stadium": None,
            "color": team.get("color"),
        }

    # -- calendário ------------------------------------------------------- #
    def _schedule(self, ctx: ProviderContext) -> list[dict]:
        data = self.fetch_json("schedule", ctx)
        events = data.get("events") or []
        if not events:
            raise ProviderError("calendário vazio na ESPN")
        return sorted(events, key=lambda e: e.get("date") or "")

    @staticmethod
    def _event_to_match(event: dict, source_name: str) -> Any:
        comp = (event.get("competitions") or [{}])[0]
        status = ((comp.get("status") or {}).get("type") or {})
        competition = competition_ref(
            (event.get("league") or {}).get("id") if isinstance(event.get("league"), dict) else None,
            ((event.get("seasonType") or {}).get("name") or "Competição").strip(),
        )
        home = away = None
        for c in comp.get("competitors") or []:
            team = c.get("team") or {}
            ref = team_ref(team.get("id"), team.get("displayName") or team.get("name"),
                           _team_logo(team), c.get("score"))
            if c.get("homeAway") == "home":
                home = ref
            else:
                away = ref
        if home is None or away is None:
            raise ProviderError("evento ESPN sem competidores")
        venue = comp.get("venue") or {}
        completed = status.get("completed")
        kickoff = parse_dt(comp.get("date") or event.get("date"))
        return build_match(
            id_=event.get("id"),
            competition=competition,
            kickoff=kickoff,
            finished_at=kickoff if completed else None,
            home=home,
            away=away,
            status=status.get("shortDetail") or status.get("description"),
            venue=venue_ref(venue.get("fullName"), (venue.get("address") or {}).get("city")),
            source=source_name,
        )

    def _fetch_last_match(self, ctx: ProviderContext):
        events = self._schedule(ctx)
        for event in reversed(events):
            comp = (event.get("competitions") or [{}])[0]
            state = ((comp.get("status") or {}).get("type") or {}).get("state")
            if state == "post":
                return self._event_to_match(event, self.source.name)
        raise ProviderError("nenhum jogo finalizado na ESPN")

    def _fetch_next_match(self, ctx: ProviderContext):
        data = self.fetch_json("next_match", ctx)
        refs = data.get("items") or []
        target = None
        for ref in refs:
            raw = ref.get("$ref") if isinstance(ref, dict) else None
            url = (raw or ref).replace("http://", "https://") if isinstance(raw or ref, str) else None
            if not url:
                continue
            try:
                payload = self.http.get_json(url)
            except ProviderError:
                continue
            kickoff = parse_dt(payload.get("date"))
            if kickoff is None or kickoff < ctx.now - timedelta(hours=3):
                continue
            target = payload
            break
        if target is None:
            raise ProviderError("sem jogos futuros na ESPN")
        event_id = target.get("id")
        try:
            summary = self.fetch_json("summary", ctx, event_id=event_id)
            match = _match_from_summary(summary, self.source.name)
            match.kickoff = parse_dt(target.get("date")) or match.kickoff
            match.id = event_id
            return match
        except ProviderError:
            return self._event_to_match(
                {"id": event_id, "date": target.get("date"), "competitions": [{}]},
                self.source.name,
            )

    # -- jogo ao vivo (widget "Tempo Real") --------------------------------- #
    @staticmethod
    def _live_dates(ctx: ProviderContext) -> list[str]:
        """Hoje e ontem (`YYYYMMDD`): o "dia" do placar da ESPN não segue o
        fuso configurado, então um jogo da noite pode ficar na lista do dia
        anterior — o widget precisa enxergar os dois."""
        try:
            from zoneinfo import ZoneInfo

            now = ctx.now.astimezone(ZoneInfo(ctx.timezone or "America/Sao_Paulo"))
        except Exception:  # noqa: BLE001 - fuso inválido não pode quebrar o widget
            now = ctx.now
        return [
            now.strftime("%Y%m%d"),
            (now - timedelta(days=1)).strftime("%Y%m%d"),
        ]

    def _fetch_live_match(self, ctx: ProviderContext):
        """Jogo do nosso time em andamento no placar (`state == "in"`)."""
        team_id = str(self.team_id(ctx))
        team_name = str(ctx.team_name or "").lower()
        league: dict = {}
        events: list[dict] = []
        seen: set[str] = set()
        for day in self._live_dates(ctx):
            data = self.fetch_json("live_match", ctx, date=day)
            league = league or ((data.get("leagues") or [{}])[0])
            for event in data.get("events") or []:
                event_id = str(event.get("id"))
                if event_id in seen:
                    continue
                seen.add(event_id)
                events.append(event)
        for event in events:
            comp = (event.get("competitions") or [{}])[0]
            status = ((comp.get("status") or {}).get("type") or {})
            if status.get("state") != "in":
                continue
            competitors = comp.get("competitors") or []
            ids = [str((c.get("team") or {}).get("id") or "") for c in competitors]
            names = " ".join(
                str((c.get("team") or {}).get("displayName") or "") for c in competitors
            ).lower()
            involved = (team_id and team_id in ids) or (team_name and team_name in names)
            if not involved:
                continue
            match = self._event_to_match(event, self.source.name)
            # o placar do dia não traz o nome da liga: completamos pelo topo da resposta
            if league.get("name"):
                match.competition = competition_ref(league.get("id"), league.get("name"))
            match.is_live = True
            return match
        raise ProviderError("nenhum jogo ao vivo do time agora")

    # -- elenco de logos (enriquecimento das tabelas) ----------------------- #
    def _fetch_teams(self, ctx: ProviderContext) -> list[dict]:
        data = self.fetch_json("teams", ctx)
        leagues = (data.get("sports") or [{}])[0].get("leagues") or [{}]
        teams = leagues[0].get("teams") or []
        out = []
        for entry in teams:
            team = entry.get("team") or entry
            out.append(
                {
                    "id": as_str(team.get("id")),
                    "name": team.get("displayName") or team.get("name"),
                    "short_name": team.get("shortDisplayName") or team.get("abbreviation"),
                    "logo": _team_logo(team),
                }
            )
        if not out:
            raise ProviderError("sem elenco de times na ESPN")
        return out

    # -- transmissões ----------------------------------------------------- #
    def _fetch_broadcasts(self, ctx: ProviderContext) -> list[Broadcast]:
        data = self.fetch_json("broadcasts", ctx)
        out: list[Broadcast] = []
        team_name = str(ctx.team_name or "")
        for event in data.get("events") or []:
            # placar do dia: filtra só os jogos do nosso time
            if team_name and team_name not in (event.get("name") or ""):
                continue
            comp = (event.get("competitions") or [{}])[0]
            for b in comp.get("broadcasts") or []:
                market = b.get("market") or ""
                for station in b.get("names") or []:
                    out.append(Broadcast(name=str(station), country=market or None))
            for b in comp.get("geoBroadcasts") or []:
                media = b.get("media") or {}
                if media.get("shortName"):
                    out.append(
                        Broadcast(
                            name=str(media.get("shortName")),
                            country=((b.get("type") or {}).get("abbreviation")),
                            url=media.get("href"),
                        )
                    )
        # remove duplicados preservando ordem
        seen: set[str] = set()
        unique = []
        for b in out:
            key = f"{b.name}|{b.url}"
            if key in seen:
                continue
            seen.add(key)
            unique.append(b)
        return unique

    # -- estatísticas ------------------------------------------------------ #
    def _fetch_stats(self, ctx: ProviderContext) -> Stats:
        events = self._schedule(ctx)
        team_id = str(self.team_id(ctx))
        played: list[dict] = []
        for event in events:
            comp = (event.get("competitions") or [{}])[0]
            status = ((comp.get("status") or {}).get("type") or {})
            if status.get("state") != "post":
                continue
            home = away = None
            for c in comp.get("competitors") or []:
                if c.get("homeAway") == "home":
                    home = c
                else:
                    away = c
            if not home or not away:
                continue
            try:
                hs, aws = as_int(home.get("score"), -1), as_int(away.get("score"), -1)
            except Exception:
                continue
            if hs < 0 or aws < 0:
                continue
            is_home = str((home.get("team") or {}).get("id")) == team_id
            gf, ga = (hs, aws) if is_home else (aws, hs)
            played.append(
                {
                    "event": event,
                    "date": parse_dt(comp.get("date") or event.get("date")),
                    "home": is_home,
                    "gf": gf,
                    "ga": ga,
                    "result": "W" if gf > ga else ("D" if gf == ga else "L"),
                    "opponent": (away if is_home else home).get("team", {}).get("displayName"),
                    "competition": ((event.get("seasonType") or {}).get("name") or "").strip(),
                }
            )
        if not played:
            raise ProviderError("sem jogos finalizados para estatísticas")

        played.sort(key=lambda p: p["date"] or parse_dt("2000-01-01"))
        gf_total = sum(p["gf"] for p in played)
        ga_total = sum(p["ga"] for p in played)
        results = [p["result"] for p in played]
        count = lambda pred: sum(1 for r in results if pred(r))  # noqa: E731

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

        recent: list[FormResult] = []
        for p in reversed(played[-5:]):
            recent.append(
                FormResult(
                    id=str((p["event"].get("id"))),
                    date=(p["date"].date().isoformat() if p["date"] else None),
                    opponent=p["opponent"],
                    result=p["result"],
                    score=f"{p['gf']}-{p['ga']}",
                    venue="home" if p["home"] else "away",
                    competition=p["competition"],
                )
            )

        last_comp = played[-1]["competition"] or None
        return Stats(
            season=SeasonLine(
                competition=last_comp,
                position=None,
                played=len(played),
                won=count(lambda r: r == "W"),
                drawn=count(lambda r: r == "D"),
                lost=count(lambda r: r == "L"),
                goals_for=gf_total,
                goals_against=ga_total,
                goal_difference=gf_total - ga_total,
                points=count(lambda r: r == "W") * 3 + count(lambda r: r == "D"),
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
            top_scorers=[],
        )

    # -- tabelas (fallback parcial quando o site da ESPN expõe standings) ---- #
    def _fetch_standings(self, ctx: ProviderContext) -> list:
        data = self.fetch_json("standings", ctx)
        if not data:
            raise ProviderError("sem classificação na ESPN")
        rows: list[StandingRow] = []
        entries = data.get("standings") or []
        for idx, entry in enumerate(entries, start=1):
            team = entry.get("team") or {}
            stats = {
                stat.get("name"): stat.get("value")
                for stat in entry.get("stats") or []
                if isinstance(stat, dict)
            }
            rows.append(
                StandingRow(
                    position=as_int(stats.get("rank"), idx),
                    team=team_ref(team.get("id"), team.get("displayName"), _team_logo(team)),
                    played=as_int(stats.get("gamesPlayed") or stats.get("played")),
                    won=as_int(stats.get("wins") or stats.get("won")),
                    drawn=as_int(stats.get("ties") or stats.get("draws")),
                    lost=as_int(stats.get("losses") or stats.get("lost")),
                    goals_for=as_int(stats.get("pointsFor") or stats.get("goalsFor")),
                    goals_against=as_int(stats.get("pointsAgainst") or stats.get("goalsAgainst")),
                    goal_difference=as_int(stats.get("pointDifferential") or stats.get("goalDiff")),
                    points=as_int(stats.get("points")),
                )
            )
        if not rows:
            raise ProviderError("classificação vazia na ESPN")
        comp: CompetitionRef = competition_ref(None, "Competição")
        return [
            make_table(
                competition=comp,
                season=str(ctx.season),
                rows=rows,
                highlight_team_id=self.team_id(ctx),
            )
        ]

