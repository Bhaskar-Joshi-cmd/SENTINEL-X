from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    admin,
    alerts,
    android,
    auth,
    community,
    community_member,
    connectivity,
    dashboard,
    health,
    hydro,
    inbound,
    replay,
    rivers,
    sensors,
    village_authority,
    village_delivery,
)
from app.core.config import get_settings
from app.db.supabase import get_admin_client, get_public_client

settings = get_settings()

# Warm the Supabase clients at startup so the first request does not pay
# the full client + connection initialisation cost (~2-4s on a cold start).
# The lru_cache on get_admin_client / get_public_client still applies for
# subsequent calls, but the first one is now a cache hit.
_get_admin_client = get_admin_client()
_get_public_client = get_public_client()

app = FastAPI(
    title="Himalayan CascadeGuard API",
    version="0.1.0",
    description="Prototype backend for two-river rule-based hazard scoring and resilient alert workflow.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(android.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(rivers.router, prefix="/api")
app.include_router(hydro.router, prefix="/api")
app.include_router(inbound.router, prefix="/api")
app.include_router(sensors.router, prefix="/api")
app.include_router(community.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(replay.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(village_authority.router, prefix="/api")
app.include_router(community_member.router, prefix="/api")
app.include_router(connectivity.router, prefix="/api")
app.include_router(village_delivery.router, prefix="/api")


@app.get("/")
async def root():
    return {
        "service": "Himalayan CascadeGuard",
        "status": "running",
        "docs": "/docs",
    }
