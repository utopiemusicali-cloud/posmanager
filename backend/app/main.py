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
from app.routers.settings import router as settings_router
from app.routers.transactions import router as transactions_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migrazioni colonne nuove (idempotenti)
        col_exists = (await conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'add_date'"
        ))).scalar()
        if not col_exists:
            await conn.execute(text(
                "ALTER TABLE inventory_items ADD COLUMN add_date VARCHAR(30) NOT NULL DEFAULT ''"
            ))

        # Corrispettivi su daily_closures
        for col_def in [
            ("totale_corrispettivi", "DECIMAL(10,2) NULL"),
            ("n_ricevute", "INT NULL"),
            ("canali_json", "TEXT NULL"),
            ("iva_json", "TEXT NULL"),
            ("numero_rt", "VARCHAR(64) NULL"),
        ]:
            exists = (await conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_closures' "
                f"AND COLUMN_NAME = '{col_def[0]}'"
            ))).scalar()
            if not exists:
                await conn.execute(text(
                    f"ALTER TABLE daily_closures ADD COLUMN {col_def[0]} {col_def[1]}"
                ))

        # metodo_pagamento su shop_receipts allargato a VARCHAR(128)
        mp_size = (await conn.execute(text(
            "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shop_receipts' "
            "AND COLUMN_NAME = 'metodo_pagamento'"
        ))).scalar()
        if mp_size and int(mp_size) < 128:
            await conn.execute(text(
                "ALTER TABLE shop_receipts MODIFY COLUMN metodo_pagamento VARCHAR(128)"
            ))

        # Colonne shop_settings: note_piede (aggiunta dopo la creazione iniziale)
        for col_def in [
            ("note_piede", "VARCHAR(255) NULL"),
        ]:
            exists = (await conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shop_settings' "
                f"AND COLUMN_NAME = '{col_def[0]}'"
            ))).scalar()
            if not exists:
                await conn.execute(text(
                    f"ALTER TABLE shop_settings ADD COLUMN {col_def[0]} {col_def[1]}"
                ))

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
app.include_router(settings_router)


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
