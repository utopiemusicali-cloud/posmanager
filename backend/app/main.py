from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from app.auth.router import router as auth_router
from app.auth.service import hash_password
from app.config import settings
from app.database import AsyncSessionLocal, MainSessionLocal, engine, get_company_engine, main_engine
from app.models import Base, Company, MainBase, User, UserRole
from app.models.company_settings import CompanySettings
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
from app.routers.users import router as users_router
from app.routers.admin import router as admin_router


async def _ensure_main_db_exists() -> None:
    """
    Crea posmanager_main se non esiste.
    Usa DATABASE_ROOT_URL se disponibile (consigliato), altrimenti prova con
    le credenziali dell'utente applicativo (richiede GRANT CREATE su *.* ).
    """
    db_name = settings.main_db_url.rsplit("/", 1)[-1]

    if settings.DATABASE_ROOT_URL:
        connect_url = settings.DATABASE_ROOT_URL
    else:
        base_url, _ = settings.main_db_url.rsplit("/", 1)
        connect_url = f"{base_url}/mysql"

    tmp_engine = create_async_engine(connect_url, echo=False, pool_pre_ping=True)
    try:
        async with tmp_engine.begin() as conn:
            await conn.execute(text(
                f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            ))
            # Concedi i permessi all'utente applicativo se usiamo root
            if settings.DATABASE_ROOT_URL:
                app_user = settings.DATABASE_URL.split("//")[1].split(":")[0]
                await conn.execute(text(
                    f"GRANT ALL PRIVILEGES ON `{db_name}`.* TO '{app_user}'@'%'"
                ))
                await conn.execute(text("FLUSH PRIVILEGES"))
    finally:
        await tmp_engine.dispose()


async def _migrate_company_db(conn) -> None:
    """Migrazioni colonne sul DB aziendale (idempotenti)."""

    # add_date su inventory_items
    col_exists = (await conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'add_date'"
    ))).scalar()
    if not col_exists:
        await conn.execute(text(
            "ALTER TABLE inventory_items ADD COLUMN add_date VARCHAR(30) NOT NULL DEFAULT ''"
        ))

    # Corrispettivi su daily_closures
    for col_name, col_def in [
        ("totale_corrispettivi", "DECIMAL(10,2) NULL"),
        ("n_ricevute", "INT NULL"),
        ("canali_json", "TEXT NULL"),
        ("iva_json", "TEXT NULL"),
        ("numero_rt", "VARCHAR(64) NULL"),
    ]:
        exists = (await conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'daily_closures' "
            f"AND COLUMN_NAME = '{col_name}'"
        ))).scalar()
        if not exists:
            await conn.execute(text(
                f"ALTER TABLE daily_closures ADD COLUMN {col_name} {col_def}"
            ))

    # metodo_pagamento su shop_receipts: allarga a VARCHAR(128)
    mp_size = (await conn.execute(text(
        "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shop_receipts' "
        "AND COLUMN_NAME = 'metodo_pagamento'"
    ))).scalar()
    if mp_size and int(mp_size) < 128:
        await conn.execute(text(
            "ALTER TABLE shop_receipts MODIFY COLUMN metodo_pagamento VARCHAR(128)"
        ))

    # created_at su shop_receipts: DEFAULT CURRENT_TIMESTAMP
    cr_default = (await conn.execute(text(
        "SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shop_receipts' "
        "AND COLUMN_NAME = 'created_at'"
    ))).scalar()
    if cr_default is None:
        await conn.execute(text(
            "ALTER TABLE shop_receipts "
            "MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
        ))

    # note_piede su shop_settings
    for col_name, col_def in [
        ("note_piede", "VARCHAR(255) NULL"),
    ]:
        exists = (await conn.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shop_settings' "
            f"AND COLUMN_NAME = '{col_name}'"
        ))).scalar()
        if not exists:
            await conn.execute(text(
                f"ALTER TABLE shop_settings ADD COLUMN {col_name} {col_def}"
            ))


async def _seed_main_db() -> None:
    """
    Prima esecuzione: crea azienda Oblique Strategies, migra utenti dal DB aziendale
    al DB principale e crea il token Discogs in company_settings.
    """
    async with MainSessionLocal() as main_db:
        # Controlla se esistono già aziende
        company_count = (await main_db.execute(select(Company))).scalars().first()
        if company_count:
            return  # già migrato

        # 1. Crea azienda Oblique Strategies
        company = Company(
            name="Oblique Strategies",
            db_name=settings.default_company_db,
            is_active=True,
        )
        main_db.add(company)
        await main_db.flush()  # ottieni company.id

        # 2. Leggi gli utenti dalla vecchia tabella users nel DB aziendale (raw SQL)
        old_users: list[dict] = []
        try:
            async with AsyncSessionLocal() as comp_db:
                rows = await comp_db.execute(text(
                    "SELECT username, hashed_password, display_name, is_active FROM users"
                ))
                old_users = [dict(r._mapping) for r in rows.all()]
        except Exception:
            pass  # la tabella potrebbe non esistere o non avere questi campi

        if old_users:
            for i, u in enumerate(old_users):
                role = UserRole.admin if i == 0 else UserRole.operator
                new_user = User(
                    company_id=company.id,
                    username=u["username"],
                    hashed_password=u["hashed_password"],
                    display_name=u.get("display_name"),
                    role=role,
                    is_active=bool(u.get("is_active", True)),
                )
                main_db.add(new_user)
        else:
            # Nessun utente trovato: crea admin da env
            admin = User(
                company_id=company.id,
                username=settings.FIRST_ADMIN_USERNAME,
                hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
                display_name="Amministratore",
                role=UserRole.admin,
                is_active=True,
            )
            main_db.add(admin)

        # 3. Crea viewer di default per Oblique Strategies
        viewer = User(
            company_id=company.id,
            username=f"viewer_{settings.default_company_db}",
            hashed_password=hash_password("viewer_readonly_change_me"),
            display_name="Viewer (sola lettura)",
            role=UserRole.viewer,
            is_active=True,
        )
        main_db.add(viewer)

        try:
            await main_db.commit()
            print(f"[startup] Azienda '{company.name}' creata (db: {company.db_name}), "
                  f"{len(old_users)} utenti migrati.")
        except IntegrityError:
            # Un altro worker ha già fatto il seed in parallelo — nessun problema
            await main_db.rollback()
            return

    # 4. Crea company_settings_integrations nel DB aziendale se vuota
    async with AsyncSessionLocal() as comp_db:
        existing = (await comp_db.execute(select(CompanySettings))).scalars().first()
        if not existing:
            cs = CompanySettings(
                discogs_token=settings.DISCOGS_TOKEN or None,
                discogs_username=settings.DISCOGS_USERNAME or None,
                discogs_password=settings.DISCOGS_PASSWORD or None,
            )
            comp_db.add(cs)
            await comp_db.commit()
            print("[startup] company_settings_integrations creata con token Discogs da env.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────

    # 1. Assicura che posmanager_main esista
    await _ensure_main_db_exists()

    # 2. Crea tabelle nel DB principale (Company, User)
    async with main_engine.begin() as conn:
        await conn.run_sync(MainBase.metadata.create_all)

    # 3. Crea tabelle nel DB aziendale di default (tutti gli altri modelli)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_company_db(conn)

    # 4. Prima esecuzione: seed azienda + migrazione utenti
    await _seed_main_db()

    # 5. Crea/aggiorna superadmin se configurato in env
    if settings.SUPERADMIN_USERNAME and settings.SUPERADMIN_PASSWORD:
        async with MainSessionLocal() as db:
            sa = (await db.execute(
                select(User).where(User.username == settings.SUPERADMIN_USERNAME)
            )).scalar_one_or_none()
            if not sa:
                db.add(User(
                    company_id=None,
                    username=settings.SUPERADMIN_USERNAME,
                    hashed_password=hash_password(settings.SUPERADMIN_PASSWORD),
                    display_name="Super Admin",
                    role=UserRole.superadmin,
                    is_active=True,
                ))
                await db.commit()
                print(f"[startup] Superadmin '{settings.SUPERADMIN_USERNAME}' creato.")

    yield
    # ── Shutdown ─────────────────────────────────────────────────────────────
    await main_engine.dispose()
    await engine.dispose()


app = FastAPI(
    title="POSMANAGER API",
    version="2.0.0",
    description="Backend multi-tenant per POSMANAGER",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
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
app.include_router(users_router)
app.include_router(admin_router)


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
