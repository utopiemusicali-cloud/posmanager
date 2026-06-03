"""Arricchimento metadati come task di background sul server.
Gira fino alla fine anche se il browser viene chiuso. Stato e stop condivisi
tra i worker uvicorn tramite un file JSON nel volume (/inventory).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime

from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.release_meta import ReleaseMeta
from app.services.discogs_enrich_service import fetch_release_meta

_STATE = os.path.join(os.path.dirname(settings.DISCOGS_STATE_PATH), "enrich_state.json")
_BATCH = 10            # release per ciclo (≈11s) → heartbeat frequente
_RUNNING_WINDOW = 45   # secondi: oltre = considerato fermo


def read_state() -> dict:
    if os.path.exists(_STATE):
        try:
            with open(_STATE) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def write_state(d: dict) -> None:
    tmp = _STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, _STATE)


def is_running() -> bool:
    s = read_state()
    return bool(s.get("running")) and (time.time() - s.get("heartbeat", 0) < _RUNNING_WINDOW)


def request_stop() -> None:
    s = read_state()
    s["stop"] = True
    write_state(s)


async def _enriched_ids(db) -> set[str]:
    rows = await db.execute(
        select(ReleaseMeta.release_id).where(ReleaseMeta.raw_json.isnot(None))
    )
    return {r[0] for r in rows.all()}


async def run_enrich(unique_ids: list[str]) -> None:
    """Loop di arricchimento in background. unique_ids = release_id inventario."""
    state = {"running": True, "started_at": datetime.now().isoformat(),
             "heartbeat": time.time(), "processed": 0, "total": len(unique_ids),
             "remaining": 0, "stop": False, "error": ""}
    write_state(state)
    try:
        async with AsyncSessionLocal() as db:
            done = await _enriched_ids(db)
        todo = [r for r in unique_ids if r not in done]
        state["remaining"] = len(todo)
        write_state(state)

        while todo:
            if read_state().get("stop"):
                break
            chunk, todo = todo[:_BATCH], todo[_BATCH:]
            try:
                metas = await fetch_release_meta(settings.DISCOGS_TOKEN, chunk)
                async with AsyncSessionLocal() as db:
                    for m in metas:
                        await db.merge(ReleaseMeta(**m))
                    await db.commit()
            except Exception as e:
                cur = read_state(); cur["error"] = str(e)[:300]; write_state(cur)
                await asyncio.sleep(5)
                continue
            cur = read_state()
            cur["processed"] = cur.get("processed", 0) + len(metas)
            cur["remaining"] = len(todo)
            cur["heartbeat"] = time.time()
            write_state(cur)
    except Exception as e:
        cur = read_state(); cur["error"] = str(e)[:300]; write_state(cur)
    finally:
        cur = read_state()
        cur["running"] = False
        cur["heartbeat"] = time.time()
        write_state(cur)
