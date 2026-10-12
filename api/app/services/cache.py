"""Cache em memória com TTL + reentrega de dados expirados (stale) em falhas."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class _Entry:
    value: Any
    stored_at: float
    ttl: float

    def fresh(self) -> bool:
        return time.time() - self.stored_at <= self.ttl


class TTLCache:
    def __init__(self) -> None:
        self._data: dict[str, _Entry] = {}
        self._lock = threading.RLock()

    @staticmethod
    def make_key(*parts: Any) -> str:
        return "|".join(str(p) for p in parts)

    def get(self, key: str, allow_stale: bool = False) -> Any:
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            if entry.fresh() or allow_stale:
                return entry.value
            return None

    def set(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            self._data[key] = _Entry(value=value, stored_at=time.time(), ttl=max(ttl, 0))

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def invalidate(self, prefix: str | None = None) -> None:
        with self._lock:
            if prefix is None:
                self._data.clear()
                return
            for key in [k for k in self._data if k.startswith(prefix)]:
                self._data.pop(key, None)


cache = TTLCache()


def cached(
    key: str,
    ttl: float,
    loader: Callable[[], Any],
    *,
    allow_stale_on_error: bool = True,
) -> tuple[Any, bool]:
    """Retorna `(valor, veio_do_cache)`.

    Se o loader falhar e existir valor expirado, devolve o valor expirado.
    """
    hit = cache.get(key)
    if hit is not None:
        return hit, True
    try:
        value = loader()
    except Exception:
        if allow_stale_on_error:
            stale = cache.get(key, allow_stale=True)
            if stale is not None:
                return stale, True
        raise
    cache.set(key, value, ttl)
    return value, False
