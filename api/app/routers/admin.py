"""CRUD das fontes de dados (APIs) + teste e status."""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user_optional
from ..models import ApiSource, User, utcnow
from ..providers import ProviderContext, SourceConfig, build_provider
from ..schemas import (
    KNOWN_CAPABILITIES,
    CapabilityStatus,
    SourceCreate,
    SourceOut,
    SourceTestRequest,
    SourceTestResponse,
)
from ..services.cache import cache
from ..services.resolver import build_context, runtime_status
from ..seed import seed_sources

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _to_out(row: ApiSource) -> dict:
    return SourceOut.model_validate(
        {
            "id": row.id,
            "name": row.name,
            "kind": row.kind,
            "enabled": row.enabled,
            "priority": row.priority,
            "capabilities": row.capabilities,
            "base_url": row.base_url,
            "api_key": row.api_key,
            "headers": row.headers,
            "endpoints": row.endpoints,
            "mapping": row.mapping,
            "cache_ttl_seconds": row.cache_ttl_seconds,
            "timeout_seconds": row.timeout_seconds,
            "notes": row.notes,
            "last_status": row.last_status,
            "last_error": row.last_error,
            "last_success_at": row.last_success_at,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
    ).model_dump(mode="json")


def _scope(user: User | None) -> int | None:
    """Escopo do usuário (None = global/visitante)."""
    return user.id if user else None


def _require_scope(user: User | None) -> int:
    if user is None:
        raise HTTPException(
            status_code=401, detail="entre ou crie uma conta para gerenciar fontes"
        )
    return user.id


@router.get("/sources")
def list_sources(
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> list[dict]:
    owner = _scope(user)
    seed_sources(db, user_id=owner)
    rows = db.scalars(
        select(ApiSource)
        .where(ApiSource.owner_filter(owner))
        .order_by(ApiSource.priority, ApiSource.id)
    ).all()
    return [_to_out(row) for row in rows]


@router.post("/sources", status_code=201)
def create_source(
    payload: SourceCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    owner = _require_scope(user)
    exists = db.scalars(
        select(ApiSource).where(
            ApiSource.name == payload.name, ApiSource.owner_filter(owner)
        )
    ).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail=f"já existe uma fonte chamada '{payload.name}'")
    row = ApiSource(**payload.model_dump(), user_id=owner)
    db.add(row)
    db.commit()
    db.refresh(row)
    cache.invalidate()
    return _to_out(row)


def _get_row(db: Session, source_id: int, owner: int | None) -> ApiSource:
    row = db.get(ApiSource, source_id)
    if row is None or row.user_id != owner:
        raise HTTPException(status_code=404, detail="fonte não encontrada")
    return row


@router.put("/sources/{source_id}")
def update_source(
    source_id: int,
    payload: SourceCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    owner = _require_scope(user)
    row = _get_row(db, source_id, owner)
    duplicate = db.scalars(
        select(ApiSource).where(
            ApiSource.name == payload.name,
            ApiSource.id != source_id,
            ApiSource.owner_filter(owner),
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail=f"já existe uma fonte chamada '{payload.name}'")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    cache.invalidate()
    return _to_out(row)


@router.delete("/sources/{source_id}")
def delete_source(
    source_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    owner = _require_scope(user)
    row = _get_row(db, source_id, owner)
    db.delete(row)
    db.commit()
    cache.invalidate()
    return {"deleted": source_id}


def _serialize(value: Any, limit: int = 4000) -> Any:
    try:
        if hasattr(value, "model_dump"):
            value = value.model_dump(mode="json")
        elif isinstance(value, list):  # listas de modelos (ex.: transmissoras)
            value = [
                item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                for item in value
            ]
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        text = str(value)
    if len(text) > limit:
        return text[:limit] + "… (truncado)"
    return json.loads(text)


@router.post("/sources/test")
def test_source(
    payload: SourceTestRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    owner = _scope(user)
    if payload.id is not None:
        row = _get_row(db, payload.id, owner)
        source = SourceConfig.from_model(row)
    elif payload.source is not None:
        source = SourceConfig(id=None, **payload.source.model_dump())
    else:
        raise HTTPException(status_code=422, detail="informe 'id' ou 'source'")

    capability = payload.capability or (source.capabilities or [None])[0]
    if not capability:
        raise HTTPException(status_code=422, detail="informe a 'capability' a testar")
    if capability not in KNOWN_CAPABILITIES:
        raise HTTPException(status_code=422, detail=f"capability desconhecida: {capability}")

    ctx: ProviderContext = build_context(db, user_id=owner)
    started = time.time()
    url: str | None = None
    status_code: int | None = None
    sample: Any = None
    normalized: Any = None
    error: str | None = None
    ok = False
    url_error: str | None = None

    try:
        provider = build_provider(source)
    except Exception as exc:  # noqa: BLE001
        return SourceTestResponse(
            ok=False, elapsed_ms=int((time.time() - started) * 1000), error=str(exc)
        ).model_dump(mode="json")

    if source.kind != "static_json":
        try:
            url = provider.url(capability, ctx)
            response = provider.http.request("GET", url)
            status_code = response.status_code
            sample = response.text[:2000]
        except Exception as exc:  # noqa: BLE001 - amostra é melhor esforço
            url_error = str(exc)

    try:
        normalized = provider.fetch(capability, ctx)
        ok = normalized is not None
    except Exception as exc:  # noqa: BLE001
        error = str(exc) or url_error
    if not ok and error is None:
        error = url_error or "sem dados retornados"

    return SourceTestResponse(
        ok=ok,
        status_code=status_code,
        elapsed_ms=int((time.time() - started) * 1000),
        url=url,
        sample=_serialize(sample) if sample is not None else None,
        normalized=_serialize(normalized) if normalized is not None else None,
        error=error,
    ).model_dump(mode="json")


@router.get("/status")
def status(
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
) -> dict:
    owner = _scope(user)
    seed_sources(db, user_id=owner)
    rows = db.scalars(
        select(ApiSource)
        .where(ApiSource.owner_filter(owner))
        .order_by(ApiSource.priority, ApiSource.id)
    ).all()
    out: list[CapabilityStatus] = []
    for capability in KNOWN_CAPABILITIES:
        matching = [r for r in rows if capability in (r.capabilities or [])]
        if not matching:
            continue
        enabled = [r for r in matching if r.enabled]
        active = enabled[0] if enabled else None
        live = runtime_status(active.id, capability) if active else None
        out.append(
            CapabilityStatus(
                capability=capability,
                active_source=active.name if active else None,
                status=(live or {}).get("status") or (active.last_status if active else None)
                or "desabilitada",
                error=(live or {}).get("error") if live else (active.last_error if active else None),
                last_success_at=active.last_success_at if active else None,
                fallbacks_available=[r.name for r in matching if r is not active],
            )
        )
    return {"capabilities": [c.model_dump(mode="json") for c in out]}
