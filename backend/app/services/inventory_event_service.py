"""Registrazione dello storico modifiche inventario (inventory_events).

Principio: lo storico è un effetto collaterale, non deve mai far fallire
l'operazione che lo genera. Se il log va in errore, l'articolo resta salvato
e l'errore viene ingoiato (loggato a stderr), perché perdere una riga di
cronologia è meno grave che perdere la modifica dell'utente.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory_event import InventoryEvent
from app.models.inventory_item import InventoryItem

logger = logging.getLogger(__name__)

# Campi di cui vale la pena tenere traccia. Escludono i metadati Discogs
# (artist/title/label...) che cambiano solo per correzioni del catalogo
# a monte e riempirebbero lo storico di rumore a ogni sync.
TRACKED_FIELDS = {
    "price", "costo_unitario", "status", "media_condition", "sleeve_condition",
    "location", "external_id", "comments", "accept_offer", "quantity",
}

# Etichette leggibili per la UI
FIELD_LABELS = {
    "price": "Prezzo",
    "costo_unitario": "Costo unitario",
    "status": "Stato",
    "media_condition": "Condizione media",
    "sleeve_condition": "Condizione copertina",
    "location": "Location",
    "external_id": "External ID",
    "comments": "Note",
    "accept_offer": "Accetta offerte",
    "quantity": "Quantità",
}


def _norm(value: object) -> str:
    """Normalizza per il confronto: None e '' sono equivalenti, i numeri
    vengono confrontati come float per non registrare 10 -> 10.00."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Y" if value else "N"
    if isinstance(value, (int, float)):
        return f"{float(value):g}"
    s = str(value).strip()
    # Anche le stringhe che contengono numeri ("10.00") vanno normalizzate,
    # altrimenti il confronto con il float del form genera falsi cambiamenti.
    try:
        return f"{float(s):g}"
    except (TypeError, ValueError):
        return s


def diff_fields(item: InventoryItem, changes: dict) -> list[tuple[str, str, str]]:
    """Confronta i valori nuovi con quelli attuali dell'item.
    Va chiamato PRIMA di applicare le modifiche. Restituisce solo i campi
    realmente cambiati, come (campo, valore_vecchio, valore_nuovo)."""
    out: list[tuple[str, str, str]] = []
    for field, new_value in changes.items():
        if field not in TRACKED_FIELDS:
            continue
        old_norm = _norm(getattr(item, field, None))
        new_norm = _norm(new_value)
        if old_norm != new_norm:
            out.append((field, old_norm, new_norm))
    return out


async def record(
    db: AsyncSession,
    *,
    listing_id: str,
    changes: list[tuple[str, str, str]],
    event_type: str = "updated",
    source: str = "ui",
    user_id: int | None = None,
    username: str = "",
    note: str = "",
) -> None:
    """Aggiunge gli eventi alla sessione (il commit è del chiamante, così
    storico e modifica finiscono nella stessa transazione)."""
    try:
        for field, old_value, new_value in changes:
            db.add(InventoryEvent(
                listing_id=listing_id,
                event_type="sold" if (field == "status" and new_value == "Sold") else event_type,
                field=field,
                old_value=old_value,
                new_value=new_value,
                source=source,
                user_id=user_id,
                username=username,
                note=note,
            ))
    except Exception:
        logger.exception("Impossibile registrare lo storico per %s", listing_id)


async def record_simple(
    db: AsyncSession,
    *,
    listing_id: str,
    event_type: str,
    source: str = "ui",
    user_id: int | None = None,
    username: str = "",
    note: str = "",
) -> None:
    """Evento senza diff di campo (creazione, cancellazione, push Discogs)."""
    try:
        db.add(InventoryEvent(
            listing_id=listing_id,
            event_type=event_type,
            source=source,
            user_id=user_id,
            username=username,
            note=note,
        ))
    except Exception:
        logger.exception("Impossibile registrare l'evento %s per %s", event_type, listing_id)


async def history_for(db: AsyncSession, listing_id: str, limit: int = 200) -> list[dict]:
    rows = (await db.execute(
        select(InventoryEvent)
        .where(InventoryEvent.listing_id == listing_id)
        .order_by(InventoryEvent.created_at.desc(), InventoryEvent.id.desc())
        .limit(limit)
    )).scalars().all()
    return [to_dict(e) for e in rows]


def to_dict(e: InventoryEvent) -> dict:
    return {
        "id": e.id,
        "listing_id": e.listing_id,
        "event_type": e.event_type,
        "field": e.field,
        "field_label": FIELD_LABELS.get(e.field, e.field),
        "old_value": e.old_value,
        "new_value": e.new_value,
        "source": e.source,
        "username": e.username,
        "note": e.note,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }
