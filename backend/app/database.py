from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

# ── DB principale (posmanager_main): companies + users ────────────────────────
main_engine = create_async_engine(
    settings.main_db_url,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
)
MainSessionLocal = async_sessionmaker(main_engine, expire_on_commit=False, class_=AsyncSession)

# ── Cache engine per-azienda ──────────────────────────────────────────────────
_company_engines: dict[str, AsyncEngine] = {}


def get_company_engine(db_name: str) -> AsyncEngine:
    """Restituisce (e cachea) un AsyncEngine per il DB aziendale richiesto."""
    if db_name not in _company_engines:
        base, _ = settings.main_db_url.rsplit("/", 1)
        url = f"{base}/{db_name}"
        _company_engines[db_name] = create_async_engine(
            url, echo=False, pool_size=10, max_overflow=20, pool_pre_ping=True
        )
    return _company_engines[db_name]


def get_company_session_maker(db_name: str) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        get_company_engine(db_name), expire_on_commit=False, class_=AsyncSession
    )


# ── Sessione DB principale (auth/login, gestione utenti/aziende) ──────────────
async def get_main_db() -> AsyncGenerator[AsyncSession, None]:
    async with MainSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── Sessione DB aziendale (routing via JWT) ───────────────────────────────────
# Usa OAuth2PasswordBearer con auto_error=False per leggere il token
# senza obbligare l'autenticazione (il controllo auth avviene in get_current_user).
_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)


async def get_db(token: str | None = Depends(_oauth2)) -> AsyncGenerator[AsyncSession, None]:
    """
    Dipendenza FastAPI per la sessione del DB aziendale.
    Decodifica il JWT per ottenere 'cdb' (company db name) e ruota sull'engine corretto.
    Senza token → usa il DB aziendale di default (backward-compat).
    """
    db_name = settings.default_company_db
    if token:
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            db_name = payload.get("cdb") or settings.default_company_db
        except JWTError:
            pass

    maker = get_company_session_maker(db_name)
    async with maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── Backward-compat: sessione default (enrich_worker, startup migration) ──────
engine = get_company_engine(settings.default_company_db)
AsyncSessionLocal = get_company_session_maker(settings.default_company_db)
