from __future__ import annotations

import re

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.auth.service import hash_password
from app.config import settings
from app.database import get_company_engine, get_company_session_maker
from app.models import Base, Company, User, UserRole
from app.models.company_settings import CompanySettings
from app.models.shop_settings import ShopSettings


def slugify_db_name(company_name: str) -> str:
    """Genera un db_name sicuro dal nome azienda: posmanager_{slug}"""
    slug = re.sub(r"[^a-z0-9]", "_", company_name.lower())
    slug = re.sub(r"_+", "_", slug).strip("_")
    return f"posmanager_{slug}"


async def _provision_tenant_db(db_name: str) -> None:
    """CREATE DATABASE IF NOT EXISTS + GRANT per il nuovo tenant."""
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
            if settings.DATABASE_ROOT_URL:
                app_user = settings.DATABASE_URL.split("//")[1].split(":")[0]
                await conn.execute(text(
                    f"GRANT ALL PRIVILEGES ON `{db_name}`.* TO '{app_user}'@'%'"
                ))
                await conn.execute(text("FLUSH PRIVILEGES"))
    finally:
        await tmp_engine.dispose()


async def create_tenant(
    main_db: AsyncSession,
    *,
    name: str,
    db_name: str,
    admin_username: str,
    admin_password: str,
    email: str | None = None,
    discogs_token: str | None = None,
    discogs_username: str | None = None,
) -> Company:
    """
    Crea un nuovo tenant completo:
    1. Crea il database MySQL con i grant
    2. Crea le tabelle (Base.metadata.create_all)
    3. Semina company_settings_integrations e shop_settings
    4. Crea Company nel DB principale
    5. Crea utente admin + viewer nel DB principale
    """
    await _provision_tenant_db(db_name)

    new_engine = get_company_engine(db_name)
    async with new_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    maker = get_company_session_maker(db_name)
    async with maker() as cdb:
        cdb.add(CompanySettings(
            discogs_token=discogs_token or None,
            discogs_username=discogs_username or None,
        ))
        cdb.add(ShopSettings(
            ragione_sociale=name,
            email=email or None,
        ))
        await cdb.commit()

    company = Company(name=name, db_name=db_name, is_active=True)
    main_db.add(company)
    await main_db.flush()

    main_db.add(User(
        company_id=company.id,
        username=admin_username,
        hashed_password=hash_password(admin_password),
        display_name="Amministratore",
        role=UserRole.admin,
        is_active=True,
    ))
    main_db.add(User(
        company_id=company.id,
        username=f"viewer_{db_name}",
        hashed_password=hash_password("viewer_readonly_change_me"),
        display_name="Viewer (sola lettura)",
        role=UserRole.viewer,
        is_active=True,
    ))
    await main_db.flush()
    return company
