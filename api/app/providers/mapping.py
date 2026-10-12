"""Resolução de caminhos JSON e conversão para o payload canônico.

Usado pelo adapter genérico `url_json` (e nos testes), permitindo mapear
qualquer API REST para o formato que a aplicação espera.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from ..schemas import (
    Broadcast,
    CompetitionRef,
    FormResult,
    NewsItem,
    SeasonLine,
    SplitLine,
    StandingRow,
    Stats,
    TopScorer,
)
from .base import (
    as_int,
    as_str,
    build_match,
    competition_ref,
    make_table,
    parse_dt,
    team_ref,
    venue_ref,
)


def resolve_path(data: Any, path: str | None, default: Any = None) -> Any:
    """Resolve `a.b.0.c` em `data`. String vazia/None devolve `data`."""
    if path in (None, ""):
        return data
    current = data
    for part in str(path).split("."):
        if current is None:
            return default
        if isinstance(current, dict):
            current = current.get(part, default if part == str(path).split(".")[-1] else None)
        elif isinstance(current, (list, tuple)):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return default
        else:
            return default
    return current if current is not None else default


def project(data: Any, fields: dict[str, str]) -> dict[str, Any]:
    """Aplica o mapa `campo_canônico -> caminho_json`."""
    if not isinstance(data, dict):
        return {}
    return {key: resolve_path(data, path) for key, path in (fields or {}).items()}


def project_list(data: Any, fields: dict[str, str]) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [project(item, fields) for item in data]
    if isinstance(data, dict):
        return [project(data, fields)]
    return []


# --------------------------------------------------------------------------- #
# Conversores canônicos
# --------------------------------------------------------------------------- #
def rows_to_standings(
    records: list[dict],
    *,
    season: str | None,
    highlight_team_id: str | None,
    default_competition: str | None = None,
    source_name: str | None = None,
) -> list:
    if not records:
        return []
    rows: list[StandingRow] = []
    for idx, rec in enumerate(records, start=1):
        rows.append(
            StandingRow(
                position=as_int(rec.get("position"), idx),
                team=team_ref(
                    rec.get("team_id"),
                    rec.get("team_name") or "—",
                    rec.get("team_logo"),
                ),
                played=as_int(rec.get("played")),
                won=as_int(rec.get("won")),
                drawn=as_int(rec.get("drawn")),
                lost=as_int(rec.get("lost")),
                goals_for=as_int(rec.get("goals_for")),
                goals_against=as_int(rec.get("goals_against")),
                goal_difference=as_int(rec.get("goal_difference")),
                points=as_int(rec.get("points")),
                form=as_str(rec.get("form")),
                note=as_str(rec.get("note")),
            )
        )
    first = records[0]
    comp = competition_ref(
        first.get("competition_id") or None,
        first.get("competition_name") or default_competition or "Competição",
        first.get("competition_logo"),
    )
    return [
        make_table(
            competition=comp,
            season=as_str(season or first.get("season")),
            rows=rows,
            highlight_team_id=highlight_team_id,
            updated_at=parse_dt(first.get("updated_at")),
        )
    ]


def record_to_match(
    rec: dict | None,
    *,
    finished: bool,
    source_name: str | None = None,
) -> Any:
    if not rec:
        raise ValueError("registro de jogo vazio")
    kickoff = parse_dt(rec.get("kickoff"))
    if kickoff is None:
        kickoff = parse_dt(rec.get("date"))
    finished_at = parse_dt(rec.get("finished_at")) or (kickoff if finished else None)
    comp = competition_ref(
        rec.get("competition_id"),
        rec.get("competition_name") or "Competição",
        rec.get("competition_logo"),
    )
    home = team_ref(rec.get("home_id"), rec.get("home_name") or "—", rec.get("home_logo"),
                    rec.get("home_score"))
    away = team_ref(rec.get("away_id"), rec.get("away_name") or "—", rec.get("away_logo"),
                    rec.get("away_score"))
    return build_match(
        id_=rec.get("id"),
        competition=comp,
        kickoff=kickoff,
        finished_at=finished_at,
        home=home,
        away=away,
        status=as_str(rec.get("status")) or ("FT" if finished else "NS"),
        round=rec.get("round"),
        venue=venue_ref(rec.get("venue"), rec.get("city")),
        broadcasts=[
            Broadcast(name=b["name"], country=b.get("country"), url=b.get("url"),
                      logo=b.get("logo"))
            for b in (rec.get("broadcasts") or [])
            if isinstance(b, dict) and b.get("name")
        ],
        source=source_name,
    )


def records_to_news(records: list[dict], source_name: str | None = None) -> list[NewsItem]:
    import hashlib

    items: list[NewsItem] = []
    for rec in records:
        title = as_str(rec.get("title"))
        if not title:
            continue
        raw_id = as_str(rec.get("id")) or as_str(rec.get("url")) or title
        items.append(
            NewsItem(
                id=hashlib.sha1(str(raw_id).encode("utf-8")).hexdigest()[:16],
                title=title,
                summary=as_str(rec.get("summary")),
                url=as_str(rec.get("url")),
                image=as_str(rec.get("image")),
                published_at=parse_dt(rec.get("published_at")),
                source=as_str(rec.get("source")) or source_name,
            )
        )
    return items


def record_to_broadcasts(records: list[dict]) -> list[Broadcast]:
    out: list[Broadcast] = []
    for rec in records:
        name = rec.get("name") or rec.get("channel") or rec.get("title")
        if not name:
            continue
        out.append(
            Broadcast(
                name=str(name),
                country=as_str(rec.get("country")),
                url=as_str(rec.get("url")),
                logo=as_str(rec.get("logo")),
            )
        )
    return out


def record_to_stats(rec: dict | None) -> Stats:
    if not rec:
        raise ValueError("registro de estatísticas vazio")

    def line(cls, key: str):
        payload = rec.get(key)
        if isinstance(payload, dict):
            return cls(**{k: v for k, v in payload.items() if k in cls.model_fields})
        return None

    form_raw = rec.get("recent_form") or []
    recent: list[FormResult] = []
    if isinstance(form_raw, list):
        for item in form_raw:
            if not isinstance(item, dict):
                continue
            result = str(item.get("result") or "").upper()[:1]
            recent.append(
                FormResult(
                    id=as_str(item.get("id")),
                    date=as_str(item.get("date")),
                    opponent=str(item.get("opponent") or "—"),
                    result=result if result in {"W", "D", "L"} else None,
                    score=as_str(item.get("score")),
                    venue=item.get("venue") if item.get("venue") in {"home", "away"} else None,
                    competition=as_str(item.get("competition")),
                )
            )
    scorers: list[TopScorer] = []
    for item in rec.get("top_scorers") or []:
        if isinstance(item, dict) and item.get("name"):
            scorers.append(
                TopScorer(
                    name=str(item["name"]),
                    goals=item.get("goals"),
                    assists=item.get("assists"),
                    matches=item.get("matches"),
                )
            )
    season = rec.get("season")
    if isinstance(season, dict):
        season_obj = SeasonLine(**{k: v for k, v in season.items() if k in SeasonLine.model_fields})
    else:
        season_obj = line(SeasonLine, "season")
    return Stats(
        season=season_obj,
        home=line(SplitLine, "home"),
        away=line(SplitLine, "away"),
        goals_scored=rec.get("goals_scored"),
        goals_conceded=rec.get("goals_conceded"),
        clean_sheets=rec.get("clean_sheets"),
        avg_goals_scored=rec.get("avg_goals_scored"),
        avg_goals_conceded=rec.get("avg_goals_conceded"),
        unbeaten_streak=rec.get("unbeaten_streak"),
        win_streak=rec.get("win_streak"),
        goalless_draws=rec.get("goalless_draws"),
        recent_form=recent,
        top_scorers=scorers,
    )


def record_to_team(rec: dict | None) -> dict:
    if not rec:
        raise ValueError("registro de time vazio")
    return {
        "id": as_str(rec.get("id")),
        "name": rec.get("name") or "Time",
        "short_name": rec.get("short_name") or rec.get("name") or "Time",
        "logo": rec.get("logo"),
        "city": rec.get("city"),
        "stadium": rec.get("stadium"),
        "color": rec.get("color"),
    }


LIST_CAPABILITIES = {"standings", "news", "tv", "broadcasts"}
SINGLE_CAPABILITIES = {"next_match", "last_match", "live_match", "stats", "team"}


def _select_record(
    records: list[dict],
    mode: str | None,
    now: datetime | None,
    finished: bool,
) -> dict:
    if not records:
        raise ValueError("mapping retornou lista vazia")
    if mode in (None, "first"):
        return records[0]
    dated = [(parse_dt(r.get("kickoff") or r.get("date")), idx, r) for idx, r in enumerate(records)]
    dated = [d for d in dated if d[0] is not None]
    if not dated:
        return records[0]
    if mode == "last":
        return max(dated, key=lambda d: d[0])[2]
    if mode == "next":
        reference = now or datetime.now(timezone.utc)
        future = [d for d in dated if d[0] >= reference - timedelta(hours=3)]
        pool = future or dated
        return min(pool, key=lambda d: d[0])[2]
    if mode == "finished":
        done = [d for d in dated if (d[2].get("finished_at") or d[2].get("home_score") not in (None, ""))]
        return (max(done, key=lambda d: d[0]) if done else max(dated, key=lambda d: d[0]))[2]
    raise ValueError(f"select inválido: {mode}")


def normalize_mapping(
    raw: Any,
    spec: dict,
    capability: str,
    *,
    highlight_team_id: str | None = None,
    season: str | None = None,
    finished: bool | None = None,
    source_name: str | None = None,
    now: datetime | None = None,
) -> Any:
    """Aplica o mapping configurado e devolve o payload canônico."""
    if not isinstance(spec, dict):
        raise ValueError("mapping deve ser um objeto com 'root' e 'fields'")
    root = spec.get("root", "")
    fields = spec.get("fields") or spec.get("item_fields") or {}
    value = resolve_path(raw, root)
    if capability in LIST_CAPABILITIES:
        records = project_list(value, fields)
        if capability == "standings":
            tables = rows_to_standings(
                records,
                season=season,
                highlight_team_id=highlight_team_id,
                source_name=source_name,
            )
            if not tables:
                raise ValueError("mapping não retornou nenhuma linha de classificação")
            return tables
        if capability == "news":
            return records_to_news(records, source_name)
        return record_to_broadcasts(records)

    if capability in SINGLE_CAPABILITIES:
        if isinstance(value, list):
            records = project_list(value, fields)
            record = _select_record(records, spec.get("select"), now, bool(finished))
        elif isinstance(value, dict):
            record = project(value, fields)
        else:
            raise ValueError("root do mapping não resolve para objeto/lista")
        if capability in ("next_match", "last_match", "live_match"):
            is_finished = finished if finished is not None else capability == "last_match"
            match = record_to_match(record, finished=is_finished, source_name=source_name)
            if capability == "live_match":
                match.is_live = True
            return match
        if capability == "stats":
            return record_to_stats(record)
        return record_to_team(record)

    raise ValueError(f"capability '{capability}' não suportada pelo mapping")


def competition_from_id(name: str | None, id_: str | None) -> CompetitionRef:
    return competition_ref(id_, name or "Competição")
