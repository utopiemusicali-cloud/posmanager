"""Importa il CSV export Discogs nella tabella inventory_items (DB aziendale).

Fa upsert per listing_id e rimuove i listing Discogs non più presenti
nell'ultimo export (rispecchia lo stato corrente del marketplace).
Gli articoli aggiunti manualmente dal POS (source diverso da "Discogs")
non vengono mai toccati.

Le variazioni rilevanti rilevate dall'export (status, prezzo) finiscono in
inventory_events con source="discogs_sync": è così che lo storico registra
"venduto su Discogs" senza che nessuno lo dichiari a mano.
"""
from __future__ import annotations

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.inventory_item import InventoryItem
from app.services import inventory_event_service

_REQUIRED = ["listing_id", "artist", "title", "label", "catno", "format",
             "price", "listed", "media_condition", "sleeve_condition",
             "location", "external_id", "comments", "quantity", "status",
             "release_id"]

# Campi che l'utente può aver modificato in locale e non ancora spinto su
# Discogs (discogs_dirty). Per quegli item l'export contiene ancora i valori
# vecchi: sovrascriverli cancellerebbe la modifica dell'utente prima che il
# push worker riesca a inviarla.
_LOCALLY_OWNED_WHEN_DIRTY = ["price", "media_condition", "sleeve_condition",
                             "comments", "location", "external_id"]

# Variazioni che vale la pena registrare nello storico quando arrivano dal
# sync. Gli altri campi (artist, title, label...) cambiano solo per correzioni
# del catalogo Discogs e riempirebbero lo storico di rumore.
_TRACKED_ON_SYNC = ["status", "price"]


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
        return {"created": 0, "updated": 0, "removed": 0, "total": 0,
                "sold": 0, "skipped_dirty": 0}

    async with session_maker() as db:
        existing = (await db.execute(
            select(InventoryItem).where(InventoryItem.source == "Discogs")
        )).scalars().all()
        by_listing = {i.listing_id: i for i in existing}

        seen: set[str] = set()
        created = updated = sold = skipped_dirty = 0

        for _, row in df.iterrows():
            listing_id = str(row["listing_id"]).strip()
            if not listing_id:
                continue
            seen.add(listing_id)

            item = by_listing.get(listing_id)
            is_new = item is None
            if is_new:
                item = InventoryItem(listing_id=listing_id, mode="discogs", source="Discogs")

            incoming = {
                "status": row.get("status", "") or "For Sale",
                "price": _parse_price(row.get("price", "")),
                "media_condition": row.get("media_condition", ""),
                "sleeve_condition": row.get("sleeve_condition", ""),
                "comments": row.get("comments", ""),
                "location": row.get("location", ""),
                "external_id": row.get("external_id", ""),
            }

            # Diff PRIMA di applicare, solo per gli item già esistenti.
            diffs = [] if is_new else inventory_event_service.diff_fields(
                item, {k: incoming[k] for k in _TRACKED_ON_SYNC}
            )

            # Metadati di catalogo: sempre allineati a Discogs.
            item.artist = row.get("artist", "")
            item.title = row.get("title", "")
            item.label = row.get("label", "")
            item.catno = row.get("catno", "")
            item.format = row.get("format", "")
            item.release_id = _parse_int(row.get("release_id", ""))
            item.listed = row.get("listed", "")
            item.quantity = _parse_int(row.get("quantity", ""), default=1) or 1

            # Lo status viene sempre da Discogs: è il marketplace a sapere se
            # un disco è stato venduto, non noi.
            item.status = incoming["status"]

            if item.discogs_dirty and not is_new:
                # Modifica locale in attesa di push: i valori locali sono più
                # recenti di quelli dell'export, non li sovrascriviamo.
                skipped_dirty += 1
            else:
                for field in _LOCALLY_OWNED_WHEN_DIRTY:
                    setattr(item, field, incoming[field])

            if is_new:
                db.add(item)
                created += 1
            else:
                updated += 1

            if diffs:
                await inventory_event_service.record(
                    db, listing_id=listing_id, changes=diffs,
                    source="discogs_sync", note="Rilevato dal sync Discogs",
                )
                sold += sum(1 for f, _old, new in diffs if f == "status" and new == "Sold")

        removed = 0
        for listing_id, item in by_listing.items():
            if listing_id not in seen:
                await inventory_event_service.record_simple(
                    db, listing_id=listing_id, event_type="deleted",
                    source="discogs_sync",
                    note="Non più presente nell'export Discogs",
                )
                await db.delete(item)
                removed += 1

        await db.commit()

    return {"created": created, "updated": updated, "removed": removed,
            "total": len(seen), "sold": sold, "skipped_dirty": skipped_dirty}
