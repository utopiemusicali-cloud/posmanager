"""Importa il CSV export Discogs nella tabella inventory_items (DB aziendale).

Fa upsert per listing_id e rimuove i listing Discogs non più presenti
nell'ultimo export (rispecchia lo stato corrente del marketplace).
Gli articoli aggiunti manualmente dal POS (source diverso da "Discogs")
non vengono mai toccati.
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.inventory_item import InventoryItem

_REQUIRED = ["listing_id", "artist", "title", "label", "catno", "format",
             "price", "listed", "media_condition", "sleeve_condition",
             "location", "external_id", "comments", "quantity", "status",
             "release_id"]


def _read_csv(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path, dtype=str)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    for col in _REQUIRED:
        if col not in df.columns:
            df[col] = ""
    return df.fillna("")


def _parse_price(raw: str) -> float | None:
    raw = (raw or "").strip().replace(",", ".")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_int(raw: str, default: int | None = None) -> int | None:
    raw = (raw or "").strip()
    if not raw:
        return default
    try:
        return int(float(raw))
    except ValueError:
        return default


async def import_discogs_csv(session_maker: async_sessionmaker, csv_path: str) -> dict:
    df = _read_csv(csv_path)
    if df.empty:
        # CSV vuoto/malformato: non cancellare l'inventario esistente per errore.
        return {"created": 0, "updated": 0, "removed": 0, "total": 0}

    async with session_maker() as db:
        existing = (await db.execute(
            select(InventoryItem).where(InventoryItem.source == "Discogs")
        )).scalars().all()
        by_listing = {i.listing_id: i for i in existing}

        seen: set[str] = set()
        created = updated = 0

        for _, row in df.iterrows():
            listing_id = str(row["listing_id"]).strip()
            if not listing_id:
                continue
            seen.add(listing_id)

            item = by_listing.get(listing_id)
            is_new = item is None
            if is_new:
                item = InventoryItem(listing_id=listing_id, mode="discogs", source="Discogs")

            item.artist = row.get("artist", "")
            item.title = row.get("title", "")
            item.label = row.get("label", "")
            item.catno = row.get("catno", "")
            item.format = row.get("format", "")
            item.release_id = _parse_int(row.get("release_id", ""))
            item.status = row.get("status", "") or "For Sale"
            item.price = _parse_price(row.get("price", ""))
            item.listed = row.get("listed", "")
            item.comments = row.get("comments", "")
            item.media_condition = row.get("media_condition", "")
            item.sleeve_condition = row.get("sleeve_condition", "")
            item.external_id = row.get("external_id", "")
            item.location = row.get("location", "")
            item.quantity = _parse_int(row.get("quantity", ""), default=1) or 1

            if is_new:
                db.add(item)
                created += 1
            else:
                updated += 1

        removed = 0
        for listing_id, item in by_listing.items():
            if listing_id not in seen:
                await db.delete(item)
                removed += 1

        await db.commit()

    return {"created": created, "updated": updated, "removed": removed, "total": len(seen)}
