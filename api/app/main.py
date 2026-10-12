"""Aplicação FastAPI da OndeJoga."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import APP_NAME, APP_VERSION, get_settings
from .db import get_sessionmaker, init_db
from .routers import admin, auth, data, settings, teams
from .seed import seed_sources, upgrade_scopes
from .services.auth import purge_expired


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    session = get_sessionmaker()()
    try:
        seed_sources(session)
        upgrade_scopes(session)  # instalações antigas ganham capacidades novas
        purge_expired(session)
    finally:
        session.close()
    yield


def create_app() -> FastAPI:
    settings_obj = get_settings()
    app = FastAPI(
        title=APP_NAME,
        version=APP_VERSION,
        description="Dashboard do seu time: próximo jogo, últimos resultados, tabelas, "
                    "notícias e estatísticas — com CRUD de APIs de dados.",
        lifespan=lifespan,
        # Docs ficam sob /api/ para passarem pelo proxy do nginx (um só portal).
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings_obj["cors_origins"],
        # Cookies de sessão exigem credenciais explicitamente liberadas.
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(data.router)
    app.include_router(settings.router)
    app.include_router(admin.router)
    app.include_router(auth.router)
    app.include_router(teams.router)

    @app.get("/api")
    def info() -> dict:
        return {
            "name": APP_NAME,
            "version": APP_VERSION,
            "docs": "/api/docs",
            "openapi": "/api/openapi.json",
            "endpoints": [
                "/api/dashboard",
                "/api/next-match",
                "/api/last-match",
                "/api/live-match",
                "/api/standings",
                "/api/news",
                "/api/stats",
                "/api/config",
                "/api/layout",
                "/api/auth/register",
                "/api/auth/login",
                "/api/auth/me",
                "/api/auth/profile",
                "/api/auth/reset-file",
                "/api/teams/search",
                "/api/config/team",
                "/api/admin/sources",
                "/api/admin/status",
            ],
        }

    return app


app = create_app()
