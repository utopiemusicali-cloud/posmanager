"""Sync completo dell'inventario di un'azienda da Discogs.

Estratto in un servizio a se' perche' lo usano due chiamanti: l'endpoint
manuale (POST /inventory/sync) e il worker automatico (auto_sync_worker).
Tenere una sola implementazione evita che le due strade divergano.
"""
from __future__ import annotations

import os

from app.config import settings
from app.database import get_company_session_maker
from app.services.discogs_sync_service import sync_inventory
from app.services.inventory_import_service import import_discogs_csv
from app.services.inventory_service import get_inventory_service


async def sync_company_inventory(db_name: str, token: str) -> dict:
    """Scarica l'export Discogs, ne conserva la copia CSV per-azienda e
    importa i listing in inventory_items. Restituisce le statistiche unite."""
    csv_dir = os.path.join(settings.INVENTORY_CSV_DIR, db_name)
    result = await sync_inventory(token, csv_dir)

    csv_path = os.path.join(csv_dir, result["filename"])
    stats = await import_discogs_csv(get_company_session_maker(db_name), csv_path)

    await get_inventory_service(db_name).reload()
    return {**result, **stats}
