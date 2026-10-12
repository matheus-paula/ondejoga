"""Gera `app/data/fallback.json` com dados reais das fontes.

Uso:
    cd api && DATABASE_URL=sqlite:////tmp/ondejoga_fallback.db ALLOW_NETWORK=1 \
        .venv/bin/python -m scripts.generate_fallback

O arquivo resultante é o backup usado quando todas as APIs estão fora do ar.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import get_sessionmaker, init_db  # noqa: E402
from app.schemas import Broadcast, Match, NewsItem, Stats  # noqa: E402
from app.seed import seed_sources  # noqa: E402
from app.services.resolver import build_context, resolve  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "fallback.json"
# Sem `tv`/`broadcasts`: a grade de transmissão por jogo não é reproduzível
# offline, e um chute de backup apareceria como se fosse dado real.
CAPABILITIES = ("next_match", "last_match", "standings", "news", "stats", "team", "teams")


def serialize(value) -> object:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [serialize(item) for item in value]
    return value


def main() -> int:
    init_db()
    db = get_sessionmaker()()
    try:
        seed_sources(db)
        ctx = build_context(db, limit=10)
        payload: dict[str, object] = {}
        for capability in CAPABILITIES:
            data, meta = resolve(db, capability, ctx, allow_fallback=False, update_status=False)
            if data is None:
                print(f"[skip] {capability}: {meta.error}")
                continue
            payload[capability] = serialize(data)
            print(f"[ok]   {capability}: {meta.source}")
        OUT.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )
        print(f"gravado em {OUT} ({OUT.stat().st_size} bytes)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
