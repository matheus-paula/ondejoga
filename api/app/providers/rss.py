"""Adapter RSS (Google Notícias ou qualquer feed) para a seção de notícias."""
from __future__ import annotations

import hashlib
import re
from typing import Any

import feedparser

from .base import Provider, ProviderContext, ProviderError, as_str, parse_dt

DEFAULT_ENDPOINTS = {
    "news": "https://news.google.com/rss/search?q={query}&hl=pt-BR&gl=BR&ceid=BR:pt-419",
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(text: str | None) -> str | None:
    if not text:
        return None
    clean = _TAG_RE.sub(" ", text)
    return _WS_RE.sub(" ", clean).strip() or None


def _first_image(entry: Any) -> str | None:
    media = entry.get("media_content") or entry.get("media_thumbnail") or []
    if media and isinstance(media, list) and isinstance(media[0], dict):
        return media[0].get("url")
    image = entry.get("image")
    if isinstance(image, dict):
        return image.get("href")
    enclosures = entry.get("enclosures") or []
    for enc in enclosures:
        if str(enc.get("type", "")).startswith("image"):
            return enc.get("href")
    return None


def parse_feed(text: str, source_name: str, limit: int = 10) -> list[dict]:
    """Converte um feed RSS em notícias canônicas (função pura, testável)."""
    feed = feedparser.parse(text)
    if feed.bozo and not feed.entries:
        raise ProviderError("feed RSS inválido")
    items: list[dict] = []
    for entry in feed.entries[:limit]:
        link = as_str(entry.get("link"))
        raw_id = as_str(entry.get("id")) or link or entry.get("title", "")
        published = None
        if entry.get("published_parsed"):
            from datetime import datetime, timezone

            published = datetime(*entry["published_parsed"][:6], tzinfo=timezone.utc)
        elif entry.get("updated_parsed"):
            from datetime import datetime, timezone

            published = datetime(*entry["updated_parsed"][:6], tzinfo=timezone.utc)
        else:
            published = parse_dt(entry.get("published"))
        title = _strip_html(entry.get("title")) or "(sem título)"
        items.append(
            {
                "id": hashlib.sha1(str(raw_id).encode("utf-8")).hexdigest()[:16],
                "title": title,
                "summary": _strip_html(
                    entry.get("summary") or entry.get("description")
                ),
                "url": link,
                "image": _first_image(entry),
                "published_at": published,
                "source": as_str(feed.feed.get("title")) or source_name,
            }
        )
    return items


class RSSProvider(Provider):
    kind = "rss"
    DEFAULT_ENDPOINTS = DEFAULT_ENDPOINTS

    # -- enriquecimento de imagens --------------------------------------- #
    def _image_fetcher(self, timeout: float):
        """Um cliente httpx compartilhado (GET da página + POST de resolução)."""
        import httpx

        from ..config import get_settings

        settings = get_settings()
        if not settings.get("allow_network"):

            def _blocked(url: str, data: dict | None = None) -> str:
                raise ProviderError("acesso externo desativado (ALLOW_NETWORK=0)")

            return _blocked

        headers = {
            "User-Agent": settings["user_agent"],
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        }
        client = httpx.Client(
            headers=headers,
            timeout=timeout,
            follow_redirects=True,
            http2=False,
        )

        def fetch(url: str, data: dict | None = None) -> str:
            try:
                if data is None:
                    response = client.get(url)
                else:
                    response = client.post(
                        url,
                        data=data,
                        headers={
                            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
                        },
                    )
            except httpx.HTTPError as exc:  # noqa: PERF203 - por item
                raise ProviderError(f"falha de rede ao ler imagem: {exc}") from exc
            if response.status_code >= 400:
                raise ProviderError(f"HTTP {response.status_code} em {url}")
            return response.text

        # devolve um fechador junto para o chamador encerrar a sessão
        fetch.close = client.close  # type: ignore[attr-defined]
        return fetch

    def fetch(self, capability: str, ctx: ProviderContext) -> Any:
        if capability != "news":
            raise ProviderError(f"capability '{capability}' não suportada por rss")
        url = self.url(capability, ctx)
        text = self.fetch_text(capability, ctx)
        limit = max(1, min(int(ctx.limit or 10), 50))
        items = parse_feed(text, self.source.name, limit=limit)
        if not items:
            raise ProviderError("feed sem notícias")
        mapping = self.source.mapping or {}
        rss_map = mapping.get("rss") or {}
        # Google Notícias (e vários outros) não publicam imagem no feed —
        # buscamos a imagem da página de destino, com cache por URL.
        if rss_map.get("enrich_images", True):
            from ..services.images import enrich

            fetch = self._image_fetcher(float(rss_map.get("enrich_timeout", 8)))
            try:
                enrich(
                    items,
                    fetch,
                    max_items=int(rss_map.get("enrich_limit", 6)),
                    workers=int(rss_map.get("enrich_workers", 6)),
                )
            except Exception:  # noqa: BLE001 - enriquecimento é melhor-esforço
                pass
            finally:
                close = getattr(fetch, "close", None)
                if callable(close):
                    close()
        return items
