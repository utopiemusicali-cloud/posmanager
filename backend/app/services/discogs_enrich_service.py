"""Arricchisce gli articoli con Genre/Style/Year dalla API release Discogs.
I dati vengono salvati in un file JSON cache nella stessa cartella dei CSV,
così il servizio inventario (sync) può leggerli al caricamento.
"""
from __future__ import annotations

import asyncio
import json
import os

import httpx

_META_FILE = "release_meta.json"
_UA = "posmanager/1.0 +https://oblique.example"


def cache_path(dest_dir: str) -> str:
    return os.path.join(dest_dir, _META_FILE)


def load_cache(dest_dir: str) -> dict:
    p = cache_path(dest_dir)
    if os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_cache(dest_dir: str, data: dict) -> None:
    tmp = cache_path(dest_dir) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, cache_path(dest_dir))


async def enrich_batch(token: str, release_ids: list[str], dest_dir: str) -> int:
    """Arricchisce una lista di release_id. Rispetta ~55 richieste/minuto."""
    cache = load_cache(dest_dir)
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA}
    done = 0

    async with httpx.AsyncClient(headers=headers, timeout=20) as client:
        for rid in release_ids:
            if not rid or rid in cache:
                continue
            try:
                r = await client.get(f"https://api.discogs.com/releases/{rid}")
                if r.status_code == 200:
                    d = r.json()
                    cache[rid] = {
                        "genre": ", ".join(d.get("genres") or []),
                        "style": ", ".join(d.get("styles") or []),
                        "year": str(d.get("year") or ""),
                    }
                    done += 1
                elif r.status_code == 404:
                    cache[rid] = {"genre": "", "style": "", "year": ""}
            except Exception:
                pass
            await asyncio.sleep(1.1)  # ~55/min, sotto il limite di 60

    save_cache(dest_dir, cache)
    return done
