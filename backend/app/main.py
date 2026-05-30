from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from app.auth.router import router as auth_router
from app.auth.service import hash_password
from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.models import Base, User
from app.routers.cassa import router as cassa_router
from app.routers.closures import router as closures_router
from app.routers.cost_centers import router as cost_centers_router
from app.routers.customers import router as customers_router
from app.routers.expenses import router as expenses_router
from app.routers.integrations import router as integrations_router
from app.routers.inventory import router as inventory_router
from app.routers.receipts import router as receipts_router
from app.routers.sessions import router as sessions_router
from app.routers.transactions import router as transactions_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Crea admin se non esiste nessun utente
    async with AsyncSessionLocal() as db:
        count = (await db.execute(select(User))).scalars().first()
        if not count:
            admin = User(
                username=settings.FIRST_ADMIN_USERNAME,
                hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
                display_name="Amministratore",
                is_active=True,
            )
            db.add(admin)
            await db.commit()
            print(f"[startup] Utente admin '{settings.FIRST_ADMIN_USERNAME}' creato.")

    yield
    # ── Shutdown ─────────────────────────────────────────────────────────────
    await engine.dispose()


app = FastAPI(
    title="POSMANAGER API",
    version="1.0.0",
    description="Backend per il gestionale POS Oblique Strategies",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth_router)
app.include_router(cassa_router)
app.include_router(expenses_router)
app.include_router(sessions_router)
app.include_router(closures_router)
app.include_router(receipts_router)
app.include_router(transactions_router)
app.include_router(cost_centers_router)
app.include_router(customers_router)
app.include_router(inventory_router)
app.include_router(integrations_router)


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
