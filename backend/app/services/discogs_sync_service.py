"""Scarica l'inventario aggiornato da Discogs API e salva il CSV localmente."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime

import httpx

_BASE = "https://api.discogs.com"
_UA = "posmanager/1.0 +https://github.com/utopiemusicali-cloud/posmanager"


async def sync_inventory(token: str, dest_dir: str) -> dict:
    """
    1. Richiede un nuovo export a Discogs
    2. Esegue polling fino a "success" (max ~6 min)
    3. Scarica il CSV e lo salva in dest_dir
    Returns: {"filename", "rows", "export_id", "downloaded_at"}
    """
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA}

    async with httpx.AsyncClient(headers=headers, timeout=60) as client:

        # 1. Richiedi nuovo export
        resp = await client.post(f"{_BASE}/inventory/export")
        resp.raise_for_status()

        # 2. Breve attesa iniziale
        await asyncio.sleep(5)

        # Determina l'ultima pagina della lista export
        page1 = (await client.get(f"{_BASE}/inventory/export?page=1&per_page=10")).json()
        last_page = page1["pagination"]["pages"]

        # Polling: max 40 tentativi × 10 s = ~6 min
        latest_export = None
        for _ in range(40):
            data = (
                await client.get(f"{_BASE}/inventory/export?page={last_page}&per_page=10")
            ).json()
            items = sorted(data["items"], key=lambda x: x["created_ts"], reverse=True)
            if items and items[0]["status"] == "success":
                latest_export = items[0]
                break
            await asyncio.sleep(10)

        if not latest_export:
            raise TimeoutError("Export Discogs non completato entro 6 minuti")

        # 3. Scarica il CSV (può essere grande, timeout maggiore)
        async with httpx.AsyncClient(headers=headers, timeout=300) as dl:
            csv_resp = await dl.get(latest_export["download_url"])
            csv_resp.raise_for_status()

        # 4. Salva su disco
        os.makedirs(dest_dir, exist_ok=True)
        filename = latest_export["filename"]
        filepath = os.path.join(dest_dir, filename)
        with open(filepath, "wb") as f:
            f.write(csv_resp.content)

        rows = max(0, len(csv_resp.text.splitlines()) - 1)  # escludi header

        return {
            "filename": filename,
            "rows": rows,
            "export_id": latest_export["id"],
            "downloaded_at": datetime.now().isoformat(),
        }
