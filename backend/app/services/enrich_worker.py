"""Arricchimento metadati come task di background sul server.
Gira fino alla fine anche se il browser viene chiuso. Stato e stop condivisi
tra i worker uvicorn tramite un file JSON per-azienda nel volume (/inventory).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime

from sqlalchemy import select

from app.config import settings
from app.database import get_company_session_maker
from app.models.release_meta import ReleaseMeta
from app.services.discogs_enrich_service import fetch_release_meta

_STATE_DIR = os.path.dirname(settings.DISCOGS_STATE_PATH)
_BATCH = 10            # release per ciclo (≈11s) → heartbeat frequente
_RUNNING_WINDOW = 45   # secondi: oltre = considerato fermo


def _state_path(db_name: str) -> str:
    """Un file di stato per azienda, per non mischiare progress/errori tra tenant."""
    return os.path.join(_STATE_DIR, f"enrich_state_{db_name}.json")


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


async def _enriched_ids(db) -> set[str]:
    rows = await db.execute(
        select(ReleaseMeta.release_id).where(ReleaseMeta.raw_json.isnot(None))
    )
    return {r[0] for r in rows.all()}


async def run_enrich(db_name: str, token: str, unique_ids: list[str]) -> None:
    """Loop di arricchimento in background per l'azienda db_name.
    unique_ids = release_id inventario di quell'azienda."""
    session_maker = get_company_session_maker(db_name)
    state = {"running": True, "started_at": datetime.now().isoformat(),
             "heartbeat": time.time(), "processed": 0, "total": len(unique_ids),
             "remaining": 0, "stop": False, "error": ""}
    write_state(db_name, state)
    try:
        async with session_maker() as db:
            done = await _enriched_ids(db)
        todo = [r for r in unique_ids if r not in done]
        state["remaining"] = len(todo)
        write_state(db_name, state)

        while todo:
            if read_state(db_name).get("stop"):
                break
            chunk, todo = todo[:_BATCH], todo[_BATCH:]
            retries = 0
            while retries < 3:
                try:
                    metas = await fetch_release_meta(token, chunk)
                    async with session_maker() as db:
                        for m in metas:
                            await db.merge(ReleaseMeta(**m))
                        await db.commit()
                    break  # batch riuscito
                except Exception as e:
                    cur = read_state(db_name); cur["error"] = str(e)[:300]; write_state(db_name, cur)
                    retries += 1
                    wait = 15 * retries  # 15s, 30s, 45s
                    await asyncio.sleep(wait)
            cur = read_state(db_name)
            cur["processed"] = cur.get("processed", 0) + len(chunk)
            cur["remaining"] = len(todo)
            cur["heartbeat"] = time.time()
            write_state(db_name, cur)
            await asyncio.sleep(10)  # ~60 release/min → rispetta rate limit Discogs
    except Exception as e:
        cur = read_state(db_name); cur["error"] = str(e)[:300]; write_state(db_name, cur)
    finally:
        cur = read_state(db_name)
        cur["running"] = False
        cur["heartbeat"] = time.time()
        write_state(db_name, cur)
