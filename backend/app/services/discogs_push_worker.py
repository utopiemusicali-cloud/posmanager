"""Sincronizza verso Discogs le modifiche fatte in tabella (prezzo, condizioni,
location, external_id, comments, accept_offer) sui listing con source="Discogs".

Gira come task di background sul server (stesso pattern di enrich_worker.py):
stato condiviso tra i worker uvicorn tramite file JSON per-azienda, così che
il progresso resti coerente indipendentemente da quale processo l'ha avviato.

Payload verificato contro la documentazione ufficiale Discogs per
POST /marketplace/listings/{listing_id} (agosto 2026): release_id, condition,
price, status sono obbligatori; solo i listing con status For Sale/Draft
sono modificabili (Sold/Expired si possono solo cancellare, mai editare);
status in scrittura accetta solo "For Sale"/"Draft". _validation_error()
filtra questi casi prima di chiamare l'API, per non sprecare quota e non
rischiare un prezzo/condizione non validi sull'inserzione reale. Resta
comunque consigliato un test su un listing reale prima di fidarsi su larga
scala: eventuali errori finiscono in discogs_sync_error, mai silenziosi.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime

import httpx
from sqlalchemy import select

from app.config import settings
from app.database import get_company_session_maker
from app.models.inventory_item import InventoryItem

_STATE_DIR = os.path.dirname(settings.DISCOGS_STATE_PATH)
_PACE_SECONDS = 2.0  # margine sotto i 60 req/min Discogs, condivisi con sync/enrich
_UA = "posmanager/1.0 +https://github.com/utopiemusicali-cloud/posmanager"
_RUNNING_WINDOW = 45  # secondi: oltre = considerato fermo (worker morto senza pulire lo stato)


def _state_path(db_name: str) -> str:
    return os.path.join(_STATE_DIR, f"discogs_push_state_{db_name}.json")


def read_state(db_name: str) -> dict:
    path = _state_path(db_name)
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def write_state(db_name: str, d: dict) -> None:
    path = _state_path(db_name)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, path)


def is_running(db_name: str) -> bool:
    s = read_state(db_name)
    return bool(s.get("running")) and (time.time() - s.get("heartbeat", 0) < _RUNNING_WINDOW)


def request_stop(db_name: str) -> None:
    s = read_state(db_name)
    s["stop"] = True
    write_state(db_name, s)


# Discogs modifica solo listing For Sale/Draft (Sold/Expired si possono solo
# cancellare, non editare) e il campo status in scrittura accetta solo questi
# due valori.
_PUSHABLE_STATUSES = {"For Sale", "Draft"}
_VALID_CONDITIONS = {
    "Mint (M)", "Near Mint (NM or M-)", "Very Good Plus (VG+)",
    "Very Good (VG)", "Good Plus (G+)", "Good (G)", "Fair (F)", "Poor (P)",
}


def _validation_error(item: InventoryItem) -> str | None:
    """Controlli locali prima di chiamare l'API: evitano di sprecare la
    quota Discogs su richieste che verrebbero comunque respinte, e (per il
    prezzo) evitano di mandare un valore di default rischioso."""
    if item.status not in _PUSHABLE_STATUSES:
        return f"Status '{item.status}' non modificabile su Discogs (solo For Sale/Draft)"
    if not item.release_id:
        return "release_id mancante"
    if item.media_condition not in _VALID_CONDITIONS:
        return f"Condizione media non valida per Discogs: '{item.media_condition}'"
    if item.price is None or float(item.price) <= 0:
        return "Prezzo mancante o non valido"
    return None


def _payload(item: InventoryItem) -> dict:
    return {
        "release_id": item.release_id,
        "condition": item.media_condition,
        "price": float(item.price),
        "status": item.status,
        "allow_offers": item.accept_offer == "Y",
        # Campi liberi: sempre inclusi (anche vuoti) così una modifica locale
        # che li svuota si riflette anche sul lato Discogs invece di restare
        # "appesa" al vecchio valore remoto.
        "comments": item.comments or "",
        "location": item.location or "",
        "external_id": item.external_id or "",
        # sleeve_condition è un enum: mandarlo vuoto verrebbe respinto,
        # meglio ometterlo che farlo fallire.
        **({"sleeve_condition": item.sleeve_condition} if item.sleeve_condition else {}),
    }


async def _push_one(client: httpx.AsyncClient, item: InventoryItem) -> None:
    resp = await client.post(
        f"https://api.discogs.com/marketplace/listings/{item.listing_id}",
        json=_payload(item),
    )
    resp.raise_for_status()


async def run_push(db_name: str, token: str) -> None:
    """Processa tutti gli item dirty dell'azienda al momento dell'avvio.
    Se nel frattempo arrivano nuove modifiche, verranno prese dal prossimo
    trigger (auto-avviato dopo ogni PATCH se il worker non è già in corso)."""
    session_maker = get_company_session_maker(db_name)
    state = {"running": True, "started_at": datetime.now().isoformat(),
              "heartbeat": time.time(), "processed": 0, "total": 0,
              "errors": 0, "stop": False}
    write_state(db_name, state)

    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA,
               "Content-Type": "application/json"}
    try:
        async with session_maker() as db:
            ids = (await db.execute(
                select(InventoryItem.id).where(
                    InventoryItem.source == "Discogs",
                    InventoryItem.discogs_dirty.is_(True),
                )
            )).scalars().all()
        state["total"] = len(ids)
        write_state(db_name, state)

        async with httpx.AsyncClient(headers=headers, timeout=20) as client:
            for item_id in ids:
                if read_state(db_name).get("stop"):
                    break
                async with session_maker() as db:
                    item = await db.get(InventoryItem, item_id)
                    if not item or not item.discogs_dirty:
                        continue

                    err = _validation_error(item)
                    if err:
                        # Errore permanente (dati locali non validi per Discogs):
                        # non consuma quota API, e non resta bloccato "in coda"
                        # per sempre. Riprende dirty alla prossima modifica utile.
                        item.discogs_dirty = False
                        item.discogs_sync_error = err
                        cur = read_state(db_name)
                        cur["errors"] = cur.get("errors", 0) + 1
                        write_state(db_name, cur)
                    else:
                        try:
                            await _push_one(client, item)
                            item.discogs_dirty = False
                            item.discogs_sync_error = ""
                        except Exception as e:
                            item.discogs_sync_error = str(e)[:300]
                            cur = read_state(db_name)
                            cur["errors"] = cur.get("errors", 0) + 1
                            write_state(db_name, cur)
                    await db.commit()

                cur = read_state(db_name)
                cur["processed"] = cur.get("processed", 0) + 1
                cur["heartbeat"] = time.time()
                write_state(db_name, cur)
                await asyncio.sleep(_PACE_SECONDS)
    finally:
        cur = read_state(db_name)
        cur["running"] = False
        cur["heartbeat"] = time.time()
        write_state(db_name, cur)


async def trigger_if_idle(db_name: str, token: str) -> None:
    """Avvia run_push solo se non è già in corso per questa azienda
    (chiamato dopo ogni PATCH: più modifiche ravvicinate si accodano
    nello stesso giro invece di far partire worker sovrapposti)."""
    if is_running(db_name):
        return
    asyncio.create_task(run_push(db_name, token))
