"""Adapter do JogosTV — grade de transmissão por jogo (leitura de HTML).

Não existe API gratuita com a grade por jogo do Brasileirão: a ESPN devolve
`broadcasts` vazio no Brasil, a TheSportsDB desligou o `eventstv.php` e as
demais cobram. O JogosTV publica a grade em HTML, marcando `data-channels` em
cada linha de jogo, e é isso que este adapter lê.

Só o jogo do time configurado é devolvido (data + nome do time). Quando o
jogo aparece sem canal confirmado a resposta vem vazia de propósito: a tela
fica sem a informação em vez de exibir um chute como se fosse dado real.
"""
from __future__ import annotations

import html as html_lib
import re
import threading
import time
import unicodedata
from datetime import timezone
from typing import Any
from zoneinfo import ZoneInfo

from ..schemas import Broadcast
from .base import Provider, ProviderContext, ProviderError

# (<article ... class="...game-row..." ...>, conteúdo até </article>)
_ARTICLE_RE = re.compile(r"(<article\b[^>]*>)(.*?)</article>", re.S | re.I)
_CLASS_RE = re.compile(r'class\s*=\s*"[^"]*\bgame-row\b', re.I)
_ATTR_RE = re.compile(r'([\w-]+)\s*=\s*"([^"]*)"')
_TEAM_RE = re.compile(
    r'<a\b[^>]*class="[^"]*\bteam-link\b[^"]*"[^>]*>(.*?)</a>', re.S | re.I
)
_TAG_RE = re.compile(r"<[^>]+>")

# Marcador do JogosTV para jogo cuja transmissão ainda não foi confirmada.
PLACEHOLDER_CHANNELS = {"canal a confirmar", "a confirmar", "confirmar"}

# O TheSportsDB registra o nome completo do clube e o JogosTV a forma curta
# usada no site. Os demais casos já casam por acento ou por palavra inteira.
DEFAULT_TEAM_ALIASES = {
    "atlético mineiro": "atletico mg",
}

DEFAULT_PAGE = "/jogos-do-brasileirao-serie-a"

# A página de uma rodada tem ~2 MB e o resolvedor consulta um jogo por vez:
# guarda o HTML parseado por página para não baixar de novo a cada jogo.
PAGE_TTL_SECONDS = 60 * 60
_PAGE_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_PAGE_LOCK = threading.Lock()


def normalize(value: Any) -> str:
    """Minúsculas, sem acentos e sem pontuação (nomes de time e de canal)."""
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\b(fc|sc|cr|clube|saf|futebol|associa)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


ALIASES: dict[str, str] = {
    normalize(key): normalize(value) for key, value in DEFAULT_TEAM_ALIASES.items()
}


def _clean_text(raw: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(_TAG_RE.sub(" ", raw))).strip()


def parse_rows(page_html: str) -> list[dict[str, Any]]:
    """Lê as linhas de jogo (`article.game-row`) de uma página do JogosTV."""
    rows: list[dict[str, Any]] = []
    for opening, body in _ARTICLE_RE.findall(page_html):
        if not _CLASS_RE.search(opening):
            continue
        attrs = dict(_ATTR_RE.findall(opening))
        teams = [name for name in (_clean_text(t) for t in _TEAM_RE.findall(body)) if name]
        rows.append(
            {
                "date": (attrs.get("data-data-iso") or "").strip()[:10],
                "channels": [
                    name.strip()
                    for name in (attrs.get("data-channels") or "").split("|")
                    if name.strip()
                ],
                "no_broadcast": attrs.get("data-sem-transmissao") == "true",
                "teams": teams,
            }
        )
    return rows


def confirmed_channels(row: dict[str, Any]) -> list[str]:
    """Canais confirmados do jogo — descarta o marcador de "a confirmar"."""
    if row.get("no_broadcast"):
        return []
    out: list[str] = []
    for name in row.get("channels") or []:
        if normalize(name) in PLACEHOLDER_CHANNELS:
            continue
        out.append(name)
    return out


def name_score(candidate: str, target: str) -> int:
    """3 = mesmo nome · 2 = uma palavra inteira contida na outra · 1 = mesma 1ª palavra.

    A contenção compara palavras inteiras para "inter" não casar com
    "internacional"; a 1ª palavra exige 5+ letras para "sao" não casar com
    "sao paulo" e "sao bernardo" ao mesmo tempo.
    """
    if not candidate or not target:
        return 0
    if candidate == target:
        return 3
    left, right = candidate.split(), target.split()
    if set(left) <= set(right) or set(right) <= set(left):
        return 2
    if len(left[0]) >= 5 and left[0] == right[0]:
        return 1
    return 0


def pick_row(rows: list[dict[str, Any]], day: str, target: str) -> dict[str, Any] | None:
    """Escolhe o jogo do `target` na data `day`.

    Vários jogos empatando no mesmo grau de semelhança = confronto ambíguo,
    e nesse caso não devolve nada: preferimos não mostrar a transmissão a
    mostrar a de outro jogo.
    """
    best: dict[str, Any] | None = None
    best_score = 0
    ties = 0
    for row in rows:
        if row.get("date") != day or not row.get("teams"):
            continue
        score = max(name_score(normalize(team), target) for team in row["teams"])
        if score == 0:
            continue
        if score > best_score:
            best, best_score, ties = row, score, 1
        elif score == best_score:
            ties += 1
    if best is None or ties > 1:
        return None
    return best


class JogoTVProvider(Provider):
    """Lê a grade publicada pelo JogosTV e devolve os canais de um jogo."""

    kind = "jogostv"
    DEFAULT_ENDPOINTS = {"tv": "{page}"}

    def url(self, capability: str, ctx: ProviderContext, **extra: Any) -> str:
        # A página vem de `mapping.pages`; sem ela o "testar fonte" do CRUD
        # cai na página padrão em vez de estourar KeyError.
        extra.setdefault("page", self._pages(ctx)[-1])
        return super().url(capability, ctx, **extra)

    def _pages(self, ctx: ProviderContext) -> list[str]:
        pages = (self.source.mapping or {}).get("pages") or {}
        out: list[str] = []
        for competition_id in ctx.all_competitions:
            page = pages.get(str(competition_id))
            if page and str(page) not in out:
                out.append(str(page))
        default = pages.get("default") or DEFAULT_PAGE
        if default not in out:
            out.append(str(default))
        return [str(page) for page in out]

    def _rows(self, page: str, ctx: ProviderContext) -> list[dict[str, Any]]:
        now = time.time()
        with _PAGE_LOCK:
            hit = _PAGE_CACHE.get(page)
            if hit is not None and now - hit[0] < PAGE_TTL_SECONDS:
                return hit[1]
        rows = parse_rows(self.http.get_text(self.url("tv", ctx, page=page)))
        if not rows:
            raise ProviderError(f"JogosTV: nenhum jogo em {page}")
        with _PAGE_LOCK:
            _PAGE_CACHE[page] = (time.time(), rows)
        return rows

    @staticmethod
    def _day(ctx: ProviderContext) -> str:
        """Data do jogo em `AAAA-MM-DD` no fuso configurado (padrão: hoje)."""
        raw = (ctx.date or "").strip()
        if raw:
            if "-" in raw:
                return raw[:10]
            return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
        moment = ctx.now
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        try:
            moment = moment.astimezone(ZoneInfo(ctx.timezone or "America/Sao_Paulo"))
        except Exception:  # noqa: BLE001 - fuso inválido não pode quebrar a busca
            pass
        return moment.strftime("%Y-%m-%d")

    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        if capability not in ("tv", "broadcasts"):
            raise ProviderError(f"JogosTV não atende '{capability}'")
        target = normalize(ctx.team_name)
        if not target:
            raise ProviderError("JogosTV: nenhum time configurado")
        target = ALIASES.get(target, target)
        day = self._day(ctx)
        last_error: str | None = None
        read_any_page = False
        for page in self._pages(ctx):
            try:
                rows = self._rows(page, ctx)
            except ProviderError as exc:
                last_error = str(exc)
                continue
            read_any_page = True
            row = pick_row(rows, day, target)
            if row is None:
                continue
            # Jogo encontrado: lista vazia significa "sem transmissão
            # confirmada", não uma falha — e a tela não mostra nada.
            return [
                Broadcast(name=name, country="BR")
                for name in confirmed_channels(row)
            ]
        if not read_any_page and last_error:
            raise ProviderError(last_error)
        raise ProviderError("JogosTV: jogo do time não está na grade")


def clear_page_cache() -> None:
    """Zera o cache de páginas (usado nos testes)."""
    with _PAGE_LOCK:
        _PAGE_CACHE.clear()
