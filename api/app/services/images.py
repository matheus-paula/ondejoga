"""Enriquecimento das imagens de notícia (que quase nenhum feed traz).

O RSS do Google Notícias — e muitos outros — **não** publica imagem no feed e a
página de destino do Google (uma SPA) expõe só um `og:image` genérico. Então o
caminho é:

1. resolver a URL real do artigo (Google Notícias guarda a assinatura na página);
2. buscar essa página e ler o `og:image`/`twitter:image`;
3. cachear por URL (o feed muda, a imagem não) e limitar a concorrência.

Tudo é funcional/testável: as funções de `_*` são puras e `enrich` recebe um
*fetcher* qualquer — em produção, um `httpx.Client` compartilhado.
"""
from __future__ import annotations

import html as html_mod
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Iterable

# <meta property="og:image" content="..."> (ordem dos atributos livre)
_META_OG = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image|og:image:url|twitter:image)["\'][^>]*>',
    re.I,
)
_META_CONTENT = re.compile(r'content=["\']([^"\']+)["\']', re.I)
_META_ANY = re.compile(r'(?:content|src|href)=["\']([^"\']+)["\']', re.I)
# Primeira <img> do corpo — último recurso para feeds que só descrevem a imagem.
_BODY_IMG = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)

# Assinatura que o Google coloca na página do artigo (necessária p/ redirecionar)
_NEWS_ID = "/rss/articles/"
_TS_RE = re.compile(r'data-n-a-ts="(\d+)"')
_SG_RE = re.compile(r'data-n-a-sg="([^"]+)"')

BATCHEXECUTE_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"

_CACHE_TTL_SECONDS = 6 * 3600  # imagem de notícia muda raramente

_URL_OK = ("http://", "https://", "//")


# --------------------------------------------------------------------------- #
# Funções puras
# --------------------------------------------------------------------------- #
def extract_og_image(html: str | None) -> str | None:
    """Primeira `og:image`/`twitter:image` do HTML (função pura)."""
    if not html:
        return None
    for tag in _META_OG.findall(html[:400_000]):
        match = _META_CONTENT.search(tag) or _META_ANY.search(tag)
        if match:
            url = _clean_url(match.group(1))
            if url:
                return url
    return None


def extract_body_image(html: str | None) -> str | None:
    """Primeira `<img>` do corpo (para feeds sem metatag de imagem)."""
    if not html:
        return None
    match = _BODY_IMG.search(html[:400_000])
    return _clean_url(match.group(1)) if match else None


def _clean_url(raw: str) -> str | None:
    url = html_mod.unescape(raw.strip())
    if not url.startswith(_URL_OK):
        return None
    return "https:" + url if url.startswith("//") else url


def extract_news_signature(html: str | None) -> tuple[int, str] | None:
    """`(timestamp, assinatura)` que o Google usa para validar a resolução."""
    if not html:
        return None
    ts = _TS_RE.search(html)
    sg = _SG_RE.search(html)
    if not (ts and sg):
        return None
    return int(ts.group(1)), sg.group(1)


def is_google_news_link(link: str | None) -> bool:
    return bool(link) and _NEWS_ID in str(link)


def google_news_id(link: str) -> str:
    return link.split(_NEWS_ID, 1)[1].split("?", 1)[0]


def build_batchexecute_request(
    article_id: str, timestamp: int, signature: str, locale: str = "BR:pt-419"
) -> tuple[str, dict[str, str]]:
    """`(url, dados)` do POST que devolve a URL real do artigo (puro)."""
    inner = json.dumps(
        [
            "garturlreq",
            [
                ["X", "X", ["X", "X"], None, None, 1, 1, locale, None, 1,
                 None, None, None, None, None, 0, 1],
                "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0,
            ],
            article_id,
            timestamp,
            signature,
        ],
        separators=(",", ":"),
    )
    freq = json.dumps([[["Fbv4je", inner, None, "generic"]]], separators=(",", ":"))
    return BATCHEXECUTE_URL, {"f.req": freq}


def parse_batchexecute_response(text: str | None) -> str | None:
    """Primeira URL real de artigo na resposta do `batchexecute` (puro)."""
    if not text:
        return None
    payload = text.replace("\\/", "/")
    idx = payload.find("wrb.fr")
    if idx >= 0:
        payload = payload[idx:]
    for candidate in re.findall(r'"(https?://[^"\\]+)\\?"', payload):
        lowered = candidate.lower()
        if any(
            host in lowered
            for host in ("google.com", "googleusercontent", "gstatic", "googleapis")
        ):
            continue
        if candidate.startswith(("http://", "https://")):
            return candidate
    return None


# --------------------------------------------------------------------------- #
# Cache
# --------------------------------------------------------------------------- #
class ImageCache:
    """Cache em memória por URL, com TTL e trava (multi-thread)."""

    def __init__(self, ttl: int = _CACHE_TTL_SECONDS) -> None:
        self._ttl = ttl
        self._data: dict[str, tuple[float, str | None]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> tuple[bool, str | None]:
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                return False, None
            stored_at, value = hit
            if time.time() - stored_at > self._ttl:
                del self._data[key]
                return False, None
            return True, value

    def set(self, key: str, value: str | None) -> None:
        with self._lock:
            self._data[key] = (time.time(), value)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


_GLOBAL_CACHE = ImageCache()


# --------------------------------------------------------------------------- #
# Orquestração
# --------------------------------------------------------------------------- #
# fetcher(url, data=None) -> HTML; `data` presente => POST (usado na resolução).
Fetcher = Callable[..., str]


def resolve_article_url(link: str, html: str | None, fetch: Fetcher) -> str | None:
    """URL real do artigo quando `link` é um redirecionamento do Google Notícias."""
    if not is_google_news_link(link):
        return None
    signature = extract_news_signature(html)
    if not signature:
        return None
    endpoint, data = build_batchexecute_request(
        google_news_id(link), signature[0], signature[1]
    )
    try:
        body = fetch(endpoint, data=data)
    except Exception:  # noqa: BLE001 - resolução é melhor-esforço
        return None
    return parse_batchexecute_response(body)


def load_image(
    link: str, fetch: Fetcher, cache: ImageCache, *, depth: int = 0
) -> str | None:
    """Imagem de uma notícia: cache -> redireciona -> `og:image` -> `<img>`."""
    hit, value = cache.get(link)
    if hit:
        return value

    page = fetch(link)
    image = extract_og_image(page)

    if image is None and depth == 0:
        canonical = resolve_article_url(link, page, fetch)
        if canonical:
            try:
                target = fetch(canonical)
            except Exception:  # noqa: BLE001
                target = None
            image = extract_og_image(target) or extract_body_image(target)
            if image:
                cache.set(canonical, image)

    if image is None:
        image = extract_body_image(page)

    cache.set(link, image)
    return image


def enrich(
    items: Iterable[dict],
    fetch: Fetcher,
    *,
    max_items: int = 6,
    workers: int = 6,
    cache: ImageCache | None = None,
) -> list[dict]:
    """Preenche `item['image']` com a imagem da página de destino.

    Só busca onde a imagem faltar; falhas são engolidas — a notícia simplesmente
    fica sem imagem e o front mostra o placeholder.
    """
    store = cache if cache is not None else _GLOBAL_CACHE
    pending: list[dict] = []
    for item in items[: max(1, max_items)]:
        if item.get("image"):
            continue
        url = item.get("url")
        if not url:
            continue
        hit, value = store.get(url)
        if hit:
            if value:
                item["image"] = value
            continue
        pending.append(item)

    if not pending:
        return list(items)

    def _one(item: dict) -> tuple[dict, str | None]:
        try:
            image = load_image(item["url"], fetch, store)
        except Exception:  # noqa: BLE001 - qualquer falha não derruba o feed
            image = None
        return item, image

    try:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
            futures = [pool.submit(_one, item) for item in pending]
            for future in as_completed(futures, timeout=30):
                item, image = future.result()
                if image:
                    item["image"] = image
    except Exception:  # noqa: BLE001 - timeout/executor: segue sem imagens
        pass

    return list(items)
