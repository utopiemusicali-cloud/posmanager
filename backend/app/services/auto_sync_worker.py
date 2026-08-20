"""Sync automatico dell'inventario Discogs, per tutte le aziende.

Obiettivo: quando l'utente apre l'Inventario i dati devono essere gia'
aggiornati, senza premere "Aggiorna da Discogs". L'export Discogs richiede
diversi minuti ed e' soggetto al rate limit di 60 req/min, quindi non si puo'
lanciare al login: gira qui, in background, a cadenza larga.

Concorrenza tra worker uvicorn: il backend gira con piu' processi e il
lifespan parte in ognuno. Senza coordinamento partirebbero N sync identici
sulla stessa azienda, moltiplicando le chiamate a Discogs. Si usa GET_LOCK()
di MySQL come lock distribuito: lo ottiene un solo processo e viene rilasciato
automaticamente se quel processo muore, senza lasciare lock orfani su disco.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime

from sqlalchemy import select, text

from app.config import settings
from app.database import MainSessionLocal, get_company_session_maker, main_engine
from app.models.company import Company
from app.models.company_settings import CompanySettings
from app.services.inventory_sync_service import sync_company_inventory

logger = logging.getLogger(__name__)

_LOCK_NAME = "posmanager_auto_sync"
_STATE_PATH = os.path.join(
    os.path.dirname(settings.DISCOGS_STATE_PATH), "auto_sync_state.json"
)


# ── Stato (per mostrare in UI quando e' avvenuto l'ultimo sync) ───────────────

def read_state() -> dict:
    try:
        with open(_STATE_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return {}


def _write_state(d: dict) -> None:
    tmp = _STATE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, _STATE_PATH)


def state_for(db_name: str) -> dict:
    return read_state().get(db_name, {})


def _update_state(db_name: str, **fields) -> None:
    state = read_state()
    entry = state.get(db_name, {})
    entry.update(fields)
    state[db_name] = entry
    _write_state(state)


# ── Selezione aziende da sincronizzare ────────────────────────────────────────

async def _company_token(db_name: str) -> str | None:
    """Token Discogs dell'azienda. Il fallback sul token globale vale SOLO per
    l'azienda di default: applicarlo a tutte farebbe sincronizzare ogni tenant
    con l'inventario di un'altra azienda."""
    async with get_company_session_maker(db_name)() as db:
        cs = (await db.execute(select(CompanySettings))).scalars().first()
    token = cs.discogs_token if cs else None
    if not token and db_name == settings.default_company_db:
        token = settings.DISCOGS_TOKEN
    return token or None


async def _due_companies() -> list[tuple[str, str]]:
    """(db_name, token) delle aziende attive il cui ultimo sync e' scaduto."""
    async with MainSessionLocal() as db:
        companies = (await db.execute(
            select(Company).where(Company.is_active.is_(True))
        )).scalars().all()

    interval = settings.AUTO_SYNC_INTERVAL_HOURS * 3600
    now = time.time()
    due: list[tuple[str, str]] = []

    for company in companies:
        if not company.db_name:
            continue
        last = state_for(company.db_name).get("last_success_ts", 0)
        if now - last < interval:
            continue
        try:
            token = await _company_token(company.db_name)
        except Exception:
            logger.exception("Lettura token fallita per %s", company.db_name)
            continue
        if not token:
            continue  # azienda senza integrazione Discogs: niente da sincronizzare
        due.append((company.db_name, token))

    return due


# ── Loop principale ───────────────────────────────────────────────────────────

async def _run_once() -> None:
    for db_name, token in await _due_companies():
        started = datetime.now().isoformat()
        _update_state(db_name, running=True, started_at=started)
        try:
            stats = await sync_company_inventory(db_name, token)
            _update_state(
                db_name, running=False, last_success_ts=time.time(),
                last_success_at=datetime.now().isoformat(),
                last_error="", last_stats=stats,
            )
            logger.info("Auto-sync %s completato: %s", db_name, stats)
        except Exception as e:
            # Un'azienda in errore non deve fermare le altre. Non aggiorniamo
            # last_success_ts, cosi' il prossimo giro riprova.
            _update_state(db_name, running=False, last_error=str(e)[:300],
                          last_error_at=datetime.now().isoformat())
            logger.exception("Auto-sync fallito per %s", db_name)


async def _try_acquire():
    """Prova a diventare il processo che esegue i sync. None = ci pensa un altro."""
    conn = await main_engine.connect()
    try:
        got = (await conn.execute(
            text("SELECT GET_LOCK(:name, 0)"), {"name": _LOCK_NAME}
        )).scalar()
    except Exception:
        await conn.close()
        raise
    if got == 1:
        return conn
    await conn.close()
    return None


async def _still_leader(conn) -> bool:
    """Il lock vive quanto la connessione: se questa cade (es. MySQL riavviato)
    il lock e' gia' stato ceduto e va rifatta la gara."""
    try:
        await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def run_forever() -> None:
    if not settings.AUTO_SYNC_ENABLED:
        logger.info("Auto-sync disabilitato da configurazione")
        return

    pause = settings.AUTO_SYNC_CHECK_MINUTES * 60

    while True:
        try:
            conn = await _try_acquire()
        except Exception:
            logger.exception("Auto-sync: impossibile contattare il DB per il lock")
            await asyncio.sleep(pause)
            continue

        if conn is None:
            # Sta lavorando un altro worker. Si riprova comunque piu' tardi:
            # se quel processo muore, qualcuno deve poterne prendere il posto
            # senza aspettare il riavvio del container.
            await asyncio.sleep(pause)
            continue

        logger.info("Auto-sync attivo (ogni %sh, controllo ogni %smin)",
                    settings.AUTO_SYNC_INTERVAL_HOURS, settings.AUTO_SYNC_CHECK_MINUTES)
        try:
            while await _still_leader(conn):
                try:
                    await _run_once()
                except Exception:
                    # Il loop non deve mai morire: un errore imprevisto in un
                    # giro non deve disattivare il sync fino al riavvio.
                    logger.exception("Errore nel giro di auto-sync")
                await asyncio.sleep(pause)
            logger.warning("Auto-sync: lock perso, si rifa' la gara")
        finally:
            try:
                await conn.close()  # rilascia GET_LOCK
            except Exception:
                pass
