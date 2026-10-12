"""Adapter Wikipédia (MediaWiki API) — classificações completas sem chave.

A página de um campeonato pode conter **várias** tabelas (ex.: Libertadores tem
uma por grupo). Cada `wikitable` de classificação é localizada junto do seu
cabeçalho de seção (`<h2>`/`<h3>`), que vira o rótulo da tabela — ex. "Grupo A".

Em páginas de **mata-mata** (Copa do Brasil) não há tabela de classificação;
nesse caso extraímos a **fase atual** da equipe a partir das seções da página.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

from ..schemas import BracketTie, StandingRow
from .base import (
    Provider,
    ProviderContext,
    ProviderError,
    as_int,
    as_str,
    competition_ref,
    make_table,
    team_ref,
)

DEFAULT_ENDPOINTS = {
    "standings": "?action=parse&page={page_title}&prop=text&format=json&formatversion=2",
}

DEFAULT_COLUMNS = {
    "position": 0,
    "team_name": 1,
    "points": 2,
    "played": 3,
    "won": 4,
    "drawn": 5,
    "lost": 6,
    "goals_for": 7,
    "goals_against": 8,
    "goal_difference": 9,
    "note": 10,
}

_STYLE_RE = re.compile(r"<style[^>]*>.*?</style>", re.S | re.I)
_SUP_RE = re.compile(r"<sup[^>]*>.*?</sup>", re.S | re.I)
_TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_CELL_RE = re.compile(r"<t[hd][^>]*>(.*?)</t[hd]>", re.S | re.I)
_A_RE = re.compile(r"<a[^>]*>(.*?)</a>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_TABLE_RE = re.compile(r"<table[^>]*>(.*?)</table>", re.S | re.I)
_HEADING_RE = re.compile(r"<h([1-6])[^>]*>(.*?)</h\1>", re.S | re.I)
_CAPTION_RE = re.compile(r"<caption[^>]*>(.*?)</caption>", re.S | re.I)

# Ordem lógica das fases de um mata-mata (a mais avançada vem por último).
# Cada entrada: (rank, regex exata do título da seção, rótulo canônico).
STAGE_PATTERNS: list[tuple[int, re.Pattern[str], str]] = [
    (0, re.compile(r"^(fase preliminar|fase de qualifica[çc][ãa]o)$", re.I), "Fase preliminar"),
    (1, re.compile(r"^primeira fase$", re.I), "Primeira fase"),
    (2, re.compile(r"^segunda fase$", re.I), "Segunda fase"),
    (3, re.compile(r"^terceira fase$", re.I), "Terceira fase"),
    (4, re.compile(r"^quarta fase$", re.I), "Quarta fase"),
    (5, re.compile(r"^quinta fase$", re.I), "Quinta fase"),
    (6, re.compile(r"^play-?offs?$", re.I), "Play-off"),
    (7, re.compile(r"^(trinta e dois aves|1(avas|os)?\s*avos)$", re.I), "Primeira fase"),
    (8, re.compile(r"^(dezesseis aves|oitavas? aves)$", re.I), "Oitavas de final"),
    (9, re.compile(r"^oitavas? (de final|aves)$", re.I), "Oitavas de final"),
    (10, re.compile(r"^quartas? (de final|aves)$", re.I), "Quartas de final"),
    (11, re.compile(r"^semifina(is|l)s?$", re.I), "Semifinal"),
    (12, re.compile(r"^(disputa de )?terceiro lugar$", re.I), "Disputa de 3º lugar"),
    (14, re.compile(r"^final$", re.I), "Final"),
    # "Fase final" é um contêiner (h2) que engloba oitavas/quartas/etc — só
    # aparece como resposta quando nenhuma fase específica casar.
    (-1, re.compile(r"^fase final$", re.I), "Fase final"),
]


def _stage_info(title: str) -> tuple[int, str] | None:
    """(rank, rótulo) se o título for exatamente o nome de uma fase."""
    clean = _text(title).strip()
    if not clean:
        return None
    for rank, pattern, label in STAGE_PATTERNS:
        if pattern.match(clean):
            return rank, label
    return None


def _text(fragment: str) -> str:
    fragment = _STYLE_RE.sub(" ", fragment)
    fragment = _SUP_RE.sub("", fragment)
    fragment = _TAG_RE.sub(" ", fragment)
    fragment = fragment.replace("&#160;", " ").replace("&nbsp;", " ")
    fragment = fragment.replace("&amp;", "&")
    return _WS_RE.sub(" ", fragment).strip()


def _team_name(cell: str) -> str:
    """Nome do time: último link da célula (as anteriores são bandeiras)."""
    links = [_text(a) for a in _A_RE.findall(cell)]
    links = [a for a in links if a]
    if links:
        return links[-1]
    return _text(cell)


def _looks_like_position_header(header: str) -> bool:
    """`header` (texto) parece de uma tabela de classificação?"""
    if not re.search(r"\bPos\b|Posi[çc][ãa]o", header):
        return False
    return any(token in header for token in ("Pts", "Ptd", "Pontos"))


def _is_standings_table(block: str) -> bool:
    """Detecta a tabela olhando o texto da **primeira linha**.

    Antes comparava os 4 mil primeiros caracteres crus, mas o CSS inline que a
    Wikipédia injeta dentro do `<th>` estourava essa janela e escondia o "Pts" —
    a tabela do Brasileirão deixava de ser encontrada.
    """
    match = _TR_RE.search(block)
    header = _text(match.group(1)) if match else ""
    if _looks_like_position_header(header):
        return True
    # Reserva: páginas cujo cabeçalho não está na primeira <tr>.
    window = _STYLE_RE.sub(" ", block)[:8000]
    return bool(re.search(r"\bPos\b|Posi[çc][ãa]o", window)) and (
        "Pts" in window or "Ptd" in window or "Pontos" in window
    )


def _parse_rows(block: str, columns: dict[str, int] | None) -> list[StandingRow]:
    cols = {**DEFAULT_COLUMNS, **(columns or {})}
    rows: list[StandingRow] = []
    for tr in _TR_RE.findall(block):
        cells = _CELL_RE.findall(tr)
        if len(cells) < 6:
            continue
        head = _text(cells[0]).lower()
        if head in {"pos", "posição", "#"}:
            continue
        position = as_int(_text(cells[cols["position"]]).replace("º", "").replace("°", ""), -1)
        name = _team_name(cells[cols["team_name"]]) if cols["team_name"] < len(cells) else ""
        if position < 0 or not name:
            continue

        def num(key: str, default: int = 0) -> int:
            idx = cols.get(key)
            if idx is None or idx >= len(cells):
                return default
            return as_int(_text(cells[idx]).replace("+", ""), default)

        note_idx = cols.get("note")
        note = None
        if note_idx is not None and note_idx < len(cells):
            note = as_str(_text(cells[note_idx])) or None
        rows.append(
            StandingRow(
                position=position,
                team=team_ref(None, name, None),
                played=num("played"),
                won=num("won"),
                drawn=num("drawn"),
                lost=num("lost"),
                goals_for=num("goals_for"),
                goals_against=num("goals_against"),
                goal_difference=num("goal_difference"),
                points=num("points"),
                note=note,
            )
        )
    rows.sort(key=lambda r: r.position)
    return rows


def _group_label(label: str) -> str | None:
    """'Grupo A' -> 'Grupo A'; 'Tabela X' genérica -> None."""
    clean = _text(label)
    if not clean:
        return None
    if re.match(r"^grupo\b", clean, re.I):
        return clean
    if re.match(r"^(tabela|classifica[çc][ãa]o)\b", clean, re.I):
        return None
    return clean if len(clean) <= 40 else None


def iter_standings_tables(html: str) -> list[tuple[str | None, str]]:
    """Tabelas de classificação com o rótulo da seção que as precede.

    Percorre o HTML na ordem do documento, guardando o último `<h2>`/`<h3>`
    visto; assim cada tabela herda o cabeçalho dela ("Grupo A", "Fase de
    grupos", ...).
    """
    marks: list[tuple[int, str, str]] = []
    for match in _HEADING_RE.finditer(html):
        level = int(match.group(1))
        if level <= 4:
            marks.append((match.start(), "heading", _text(match.group(2))))
    tables: list[tuple[int, str]] = []
    for match in _TABLE_RE.finditer(html):
        if _is_standings_table(match.group(1)):
            tables.append((match.start(), match.group(1)))

    out: list[tuple[str | None, str]] = []
    for position, block in tables:
        label = None
        for mark_pos, kind, text in marks:
            if mark_pos > position:
                break
            if kind == "heading":
                label = text
        # legenda da própria tabela tem precedência quando for específica
        caption = _CAPTION_RE.search(block)
        if caption:
            caption_text = _group_label(caption.group(1))
            if caption_text:
                label = caption_text
        out.append((_group_label(label) if label else None, block))
    return out


# --------------------------------------------------------------------------- #
# Mata-mata: fase atual da equipe
# --------------------------------------------------------------------------- #
def _split_sections(html: str) -> list[tuple[str, str]]:
    """Divide a página em (título, corpo) respeitando a hierarquia.

    O corpo de um título vai **até o próximo título de nível igual ou\n    superior** — assim uma fase (h3) engloba suas sub-seções (h4), que é\n    onde ficam as tabelas de confronto com os nomes das equipes.
    """
    marks = [m for m in _HEADING_RE.finditer(html) if int(m.group(1)) <= 4]
    sections: list[tuple[str, str]] = []
    for index, mark in enumerate(marks):
        level = int(mark.group(1))
        title = _text(mark.group(2))
        start = mark.end()
        end = len(html)
        for later in marks[index + 1 :]:
            if int(later.group(1)) <= level:
                end = later.start()
                break
        sections.append((title, html[start:end]))
    return sections


def _normalize(value: str) -> str:
    text = value.lower()
    for accented, plain in (
        ("á", "a"), ("à", "a"), ("â", "a"), ("ã", "a"), ("ä", "a"),
        ("é", "e"), ("ê", "e"), ("è", "e"),
        ("í", "i"), ("ì", "i"), ("î", "i"),
        ("ó", "o"), ("ô", "o"), ("õ", "o"), ("ò", "o"),
        ("ú", "u"), ("ù", "u"), ("û", "u"),
        ("ç", "c"), ("ñ", "n"),
    ):
        text = text.replace(accented, plain)
    return re.sub(r"[^a-z0-9 ]", " ", text)


def detect_team_stage(html: str, team_name: str) -> str | None:
    """Fase do mata-mata em que a equipe aparece (seção mais avançada).

    Procura as seções cujo título é exatamente o nome de uma fase e verifica
    em qual delas o time aparece. Em empate, escolhe a mais avançada.
    """
    if not team_name:
        return None
    target = _normalize(team_name)
    short = target.split()[0] if target else ""
    found: list[tuple[int, str]] = []
    for title, body in _split_sections(html):
        info = _stage_info(title)
        if info is None:
            continue
        haystack = _normalize(_text(body))
        hit = (target and target in haystack) or (
            len(short) >= 4 and bool(re.search(rf"\b{re.escape(short)}\b", haystack))
        )
        if hit:
            found.append(info)
    if not found:
        return None
    return max(found, key=lambda item: item[0])[1]


def cup_stages(html: str) -> list[str]:
    """Fases presentes na página, na ordem do torneio (para descrição)."""
    labels = [info[1] for title, _ in _split_sections(html)
              if (info := _stage_info(title))]
    seen: list[str] = []
    for label in labels:
        if label not in seen:
            seen.append(label)
    return seen


# --------------------------------------------------------------------------- #
# Mata-mata: chaves/confrontos (ex.: Libertadores e Copa do Brasil)
# --------------------------------------------------------------------------- #
_BOLD_RE = re.compile(r"<b\b", re.I)
# "4–1" · "1–1 (4–5 p )" — o agregado pode vir com pênaltis entre parênteses.
_AGG_RE = re.compile(r"(\d+)\s*[–\-—]\s*(\d+)")
_PENS_RE = re.compile(r"\((\d+)\s*[–\-—]\s*(\d+)\s*p")

# Ordem das fases: grupos antes de qualquer fase de mata-mata.
GROUP_PHASE_ORDER = 0
GROUP_PHASE_LABEL = "Fase de grupos"


def _stage_rank(label: str | None) -> int | None:
    """Rank de uma fase pelo rótulo canônico ("Quartas de final" -> 10)."""
    if not label:
        return None
    for rank, _pattern, stage_label in STAGE_PATTERNS:
        if rank >= 0 and stage_label == label.strip():
            return rank
    return None


def _stage_label(rank: int) -> str:
    """Rótulo canônico de uma fase pela ordem do torneio."""
    for stage_rank, _pattern, label in STAGE_PATTERNS:
        if stage_rank == rank:
            return label
    return f"Fase {rank}"


def phase_order(rank: int | None) -> int | None:
    """Ordem de exibição da fase (grupos = 0; mata-mata começa em 1)."""
    return None if rank is None else rank + 1


def _is_bracket_table(block: str) -> bool:
    """Tabela de confrontos do mata-mata ("Equipe 1 | Total | Equipe 2 | …").

    Precisa do "Total" no meio para separar as tabelas de jogo único, que têm
    o mesmo par de cabeçalhos ("Equipe 1 | Resultado | Equipe 2").
    """
    match = _TR_RE.search(block)
    if not match:
        return False
    header = _text(match.group(1)).lower()
    return "equipe 1" in header and "equipe 2" in header and "total" in header


def _split_total(total: str) -> tuple[str | None, str | None]:
    """Separa placar agregado e pênaltis de uma célula "Total"."""
    if not total:
        return None, None
    pens = _PENS_RE.search(total)
    penalties = f"{pens.group(1)}–{pens.group(2)}" if pens else None
    main = _AGG_RE.search(total)
    aggregate = f"{main.group(1)}–{main.group(2)}" if main else None
    return aggregate, penalties


def _parse_bracket_rows(block: str) -> list[BracketTie]:
    """Confrontos de uma tabela de mata-mata.

    O vencedor é o time destacado em `<b>` pela Wikipédia; quando nenhum dos
    dois está em negrito o confronto ainda será disputado.
    """
    trs = _TR_RE.findall(block)
    if not trs:
        return []
    labels = [_text(cell).lower() for cell in _CELL_RE.findall(trs[0])]
    try:
        home_idx = next(i for i, text in enumerate(labels) if "equipe 1" in text)
        away_idx = next(i for i, text in enumerate(labels) if "equipe 2" in text)
    except StopIteration:
        return []
    # A coluna "Chave" (A, S1, F1…) vem antes da "Equipe 1" quando existe.
    label_idx = 0 if home_idx > 0 else None
    total_idx = home_idx + 1 if home_idx + 1 < away_idx else None
    leg_idx = range(away_idx + 1, len(labels))

    out: list[BracketTie] = []
    for tr in trs[1:]:
        cells = _CELL_RE.findall(tr)
        if len(cells) <= max(home_idx, away_idx):
            continue
        home_cell, away_cell = cells[home_idx], cells[away_idx]
        home_name, away_name = _team_name(home_cell), _team_name(away_cell)
        if not home_name or not away_name:
            continue
        total = (
            _text(cells[total_idx])
            if total_idx is not None and total_idx < len(cells)
            else ""
        )
        aggregate, penalties = _split_total(total)
        legs = [leg for index in leg_idx if index < len(cells)
                if (leg := _text(cells[index]))]
        home_bold = bool(_BOLD_RE.search(home_cell))
        away_bold = bool(_BOLD_RE.search(away_cell))
        winner = (
            "home" if home_bold and not away_bold
            else "away" if away_bold and not home_bold
            else None
        )
        match = _AGG_RE.search(aggregate or "")
        out.append(
            BracketTie(
                label=(_text(cells[label_idx]) or None)
                if label_idx is not None and label_idx < len(cells)
                else None,
                home=team_ref(None, home_name, None, match.group(1) if match else None),
                away=team_ref(None, away_name, None, match.group(2) if match else None),
                aggregate=aggregate,
                legs=legs,
                penalties=penalties,
                winner=winner,
                decided=winner is not None,
            )
        )
    return out


def iter_bracket_stages(html: str) -> list[tuple[int, str, list[BracketTie]]]:
    """Fases com chaves de mata-mata: `[(rank, rótulo, confrontos)]` em ordem.

    Cada seção de fase (oitavas, quartas, semis, final…) que contenha uma
    tabela de confrontos vira uma entrada. "Fase final" é só um contêiner e é
    ignorada (rank -1) para não duplicar as fases filhas.
    """
    out: dict[int, tuple[str, list[BracketTie]]] = {}
    for title, body in _split_sections(html):
        info = _stage_info(title)
        if info is None or info[0] < 0:
            continue
        rank, label = info
        ties = [
            tie
            for match in _TABLE_RE.finditer(body)
            if _is_bracket_table(match.group(1))
            for tie in _parse_bracket_rows(match.group(1))
        ]
        if not ties:
            continue
        if rank in out:
            out[rank][1].extend(ties)
        else:
            out[rank] = (label, ties)
    return [(rank, out[rank][0], out[rank][1]) for rank in sorted(out)]


def _team_in_rows(rows: list[StandingRow], team_name: str) -> bool:
    """O time aparece em alguma linha da tabela?"""
    target = _normalize(team_name or "")
    if not target:
        return False
    short = target.split()[0]
    for row in rows:
        clean = _normalize(row.team.name)
        if target in clean:
            return True
        if len(short) >= 4 and re.search(rf"\b{re.escape(short)}\b", clean):
            return True
    return False


def _tie_side(tie: BracketTie, team_name: str) -> str | None:
    """Lado do confronto em que o time aparece ("home"/"away"), se algum."""
    target = _normalize(team_name or "")
    if not target:
        return None
    short = target.split()[0]
    sides = (("home", tie.home.name), ("away", tie.away.name))
    full = [side for side, name in sides if target in _normalize(name)]
    if len(full) == 1:
        return full[0]
    loose = [
        side
        for side, name in sides
        if len(short) >= 4 and re.search(rf"\b{re.escape(short)}\b", _normalize(name))
    ]
    return loose[0] if len(loose) == 1 else None


def bracket_team_state(
    stages: list[tuple[int, str, list[BracketTie]]], team_name: str
) -> tuple[bool | None, int | None]:
    """`(time ainda vivo?, rank da fase mais avançada em que aparece)`.

    Só olha o chaveamento: `None` quando o time não aparece em nenhuma chave
    (o chamador decide se é grupo ou eliminação); `False` quando perdeu o
    confronto; `True` quando venceu ou ainda vai jogar.
    """
    if not stages or not team_name:
        return None, None
    seen: int | None = None
    alive: bool | None = None
    for rank, _label, ties in stages:
        for tie in ties:
            side = _tie_side(tie, team_name)
            if side is None:
                continue
            seen = rank
            if tie.winner is None:
                alive = True if alive is None else alive
            elif tie.winner == side:
                alive = True
            else:
                alive = False
    return alive, seen


# --------------------------------------------------------------------------- #
# Provider
# --------------------------------------------------------------------------- #
class WikipediaProvider(Provider):
    kind = "wikipedia"
    DEFAULT_ENDPOINTS = DEFAULT_ENDPOINTS

    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        if capability != "standings":
            raise ProviderError(f"capability '{capability}' não suportada por wikipedia")
        columns = ((self.source.mapping or {}).get("standings") or {}).get("columns")
        lang = (self.source.mapping or {}).get("language") or "pt"
        base = self.source.base_url or f"https://{lang}.wikipedia.org/w/api.php"
        comps = ctx.team.get("competitions") or []
        tables: list[Any] = []
        errors: list[str] = []

        for comp in comps:
            if not isinstance(comp, dict):
                continue
            title = comp.get("page")
            if not title:
                continue
            html = self._fetch_page(base, capability, ctx, str(title))
            if html is None:
                errors.append(f"{comp.get('name', title)}: página não encontrada")
                continue
            # Página extra só com o mata-mata (ex.: Libertadores tem grupos e
            # "Fase final" em páginas separadas).
            knockout = comp.get("knockout_page")
            knockout_html = self._fetch_page(base, capability, ctx, str(knockout)) if knockout else None
            try:
                tables.extend(
                    self._tables_from_page(
                        html, comp, ctx, columns=columns, knockout_html=knockout_html
                    )
                )
            except ProviderError as exc:
                errors.append(f"{comp.get('name', title)}: {exc}")

        if not tables:
            detail = "; ".join(errors[:3]) if errors else "nenhuma página configurada (campo 'page')"
            raise ProviderError(detail)
        return tables

    def _fetch_page(
        self, base: str, capability: str, ctx: ProviderContext, title: str
    ) -> str | None:
        """HTML de uma página; None quando ela não existe (pode ser opcional)."""
        page_title = str(title).format(season=ctx.season) if "{season}" in str(title) else str(title)
        url = base + self._render_url(capability, ctx, page_title=quote(page_title, safe=""))
        try:
            payload = self.http.get_json(url)
        except ProviderError:
            return None
        if not isinstance(payload, dict) or "parse" not in payload:
            return None
        return payload["parse"].get("text") or ""

    def _tables_from_page(
        self,
        html: str,
        comp: dict,
        ctx: ProviderContext,
        *,
        columns: dict | None,
        knockout_html: str | None = None,
    ) -> list[Any]:
        comp_id = str(comp.get("id") or "")
        comp_name = str(comp.get("name") or "Competição")
        kind = str(comp.get("kind") or "league") if comp.get("kind") in ("league", "cup") else "league"
        highlight = self.team_id(ctx) or None
        found = iter_standings_tables(html)
        # Mata-mata: usa a página extra quando existir, senão a própria página.
        bracket_html = knockout_html if knockout_html is not None else html
        stages = iter_bracket_stages(bracket_html)
        # Em copas as tabelas da página são classificações de federação/potes:
        # poluem mais do que ajudam, o chaveamento é o que importa.
        use_groups = bool(found) and (kind != "cup" or not stages)
        multi = len(found) > 1

        groups: list[tuple[str | None, list]] = []
        if use_groups:
            for label, block in found:
                rows = _parse_rows(block, columns)
                if not rows:
                    continue
                groups.append((label if multi else None, rows))

        # Fase atual do time e se ele ainda segue vivo na competição.
        team_alive, current_rank = self._team_state(
            stages, groups, bracket_html, ctx.team_name
        )

        def _build(
            rows,
            *,
            group=None,
            stage=None,
            team_stage=None,
            description=None,
            phase=None,
            phase_order_value=None,
            is_current=False,
            bracket=None,
        ):
            table = make_table(
                competition=competition_ref(comp_id, comp_name, kind=kind),
                season=ctx.season or None,
                rows=rows,
                highlight_team_id=highlight,
            )
            return table.model_copy(
                update={
                    "kind": kind,
                    "group": group,
                    "stage": stage,
                    "team_stage": team_stage,
                    "description": description,
                    "phase": phase,
                    "phase_order": phase_order_value,
                    "is_current": is_current,
                    "team_alive": team_alive,
                    "bracket": bracket or [],
                }
            )

        out: list[Any] = []
        current_label = GROUP_PHASE_LABEL if current_rank is None else _stage_label(current_rank)

        if stages:
            # Competição com mata-mata: uma aba por fase, na ordem do torneio.
            for rank, label, ties in stages:
                out.append(
                    _build(
                        [],
                        stage=label,
                        team_stage=current_label,
                        description=f"{comp_name} — {label}",
                        phase=label,
                        phase_order_value=phase_order(rank),
                        is_current=(rank == current_rank),
                        bracket=ties,
                    )
                )
            # Fase atual ainda sem chave publicada (ex.: quartas sorteadas).
            if current_rank is not None and not any(
                rank == current_rank for rank, _label, _ties in stages
            ):
                out.append(
                    _build(
                        [],
                        stage=current_label,
                        team_stage=current_label,
                        description=f"{comp_name} — {current_label}",
                        phase=current_label,
                        phase_order_value=phase_order(current_rank),
                        is_current=True,
                    )
                )

        if groups:
            is_groups = bool(stages)
            for label, rows in groups:
                use_label = bool(label) and (
                    multi or label.lower() not in comp_name.lower()
                )
                out.append(
                    _build(
                        rows,
                        group=label if use_label else None,
                        description=f"{comp_name} — {label}"
                        if use_label
                        else _describe(comp_name, kind, ctx.season),
                        phase=GROUP_PHASE_LABEL if is_groups else None,
                        phase_order_value=GROUP_PHASE_ORDER if is_groups else None,
                        is_current=is_groups and current_rank is None,
                        team_stage=GROUP_PHASE_LABEL if is_groups and current_rank is None else None,
                    )
                )
        if out:
            return out

        # Nenhuma tabela aproveitável: tenta a fase da equipe na página
        # (mata-mata sem tabela de classificação).
        stage = detect_team_stage(html, ctx.team_name)
        if stage:
            out.append(
                _build(
                    [],
                    stage=stage,
                    team_stage=stage,
                    description=f"{comp_name} — {stage}",
                    phase=stage,
                    phase_order_value=phase_order(_stage_rank(stage)),
                    is_current=True,
                )
            )
            return out
        raise ProviderError("nenhuma tabela de classificação encontrada")

    @staticmethod
    def _team_state(
        stages: list[tuple[int, str, list]],
        groups: list[tuple[str | None, list]],
        bracket_html: str,
        team_name: str,
    ) -> tuple[bool | None, int | None]:
        """`(time vivo?, rank da fase atual)`.

        O chaveamento manda: se o time aparece numa chave, a fase é a mais
        avançada dele. Sem chave, a fase de grupos ainda é a atual — e quem
        não está nem nas grupos nem nas chaves já caiu fora.
        """
        alive, bracket_rank = bracket_team_state(stages, team_name)
        if bracket_rank is not None:
            # Sobe de fase só se seguiu vivo (não vale para quem foi eliminado).
            if alive:
                detected = _stage_rank(detect_team_stage(bracket_html, team_name))
                if detected is not None and detected > bracket_rank:
                    return True, detected
            return alive, bracket_rank
        if not stages:
            return None, None
        # Sem chave para o time: classificado aos grupos ou já eliminado neles.
        in_groups = any(
            _team_in_rows(rows, team_name) for _label, rows in groups
        )
        return (True, None) if in_groups else (False, None)

    def _render_url(self, capability: str, ctx: ProviderContext, **extra: str) -> str:
        from .base import build_placeholders

        template = self._endpoint(capability)
        values = build_placeholders(ctx, self.source)
        values.update({k: str(v) for k, v in extra.items()})
        try:
            path = template.format(**values)
        except (KeyError, IndexError) as exc:
            raise ProviderError(f"endpoint inválido: {exc}") from exc
        return path if path.startswith("http") else path


def _describe(name: str, kind: str, season: str | None) -> str:
    suffix = f" · {season}" if season else ""
    return f"{name} · {'Mata-mata' if kind == 'cup' else 'Pontos corridos'}{suffix}"


def parse_standings_table(
    html: str,
    *,
    competition_id: str | None,
    competition_name: str,
    season: str | None,
    highlight_team_id: str | None,
    columns: dict[str, int] | None = None,
    source_name: str | None = None,
):
    """Compat: extrai a classificação de uma página (primeira tabela válida)."""
    found = iter_standings_tables(html)
    if not found:
        raise ProviderError("nenhuma tabela de classificação encontrada na página")
    _, block = found[0]
    rows = _parse_rows(block, columns)
    if not rows:
        raise ProviderError("tabela de classificação vazia")
    return [
        make_table(
            competition=competition_ref(competition_id, competition_name),
            season=season,
            rows=rows,
            highlight_team_id=highlight_team_id,
        )
    ]
