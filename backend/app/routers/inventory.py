from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import settings
from app.database import get_db
from app.models.inventory_item import InventoryItem
from app.services.discogs_enrich_service import enrich_batch
from app.services.discogs_lookup_service import lookup_release
from app.services.discogs_sync_service import sync_inventory
from app.services.inventory_service import InventoryService

router = APIRouter(
    prefix="/api/v1/inventory",
    tags=["inventory"],
    dependencies=[Depends(get_current_user)],
)

_svc = InventoryService()

_MEDIA_CONDITIONS = [
    "Mint (M)", "Near Mint (NM or M-)", "Very Good Plus (VG+)",
    "Very Good (VG)", "Good Plus (G+)", "Good (G)", "Fair (F)", "Poor (P)",
]
_SLEEVE_CONDITIONS = _MEDIA_CONDITIONS + ["Generic", "Not Graded", "No Cover"]
_LOCATIONS = ["UNOFF", "OS Records", "Deposito"]


# ── GET inventory (CSV + MySQL merged) ────────────────────────────────────────

def _item_to_dict(item: InventoryItem) -> dict:
    return {
        "source": item.source,
        "listing_id": item.listing_id,
        "artist": item.artist,
        "title": item.title,
        "label": item.label,
        "catno": item.catno,
        "format": item.format,
        "price": str(item.price) if item.price else "",
        "listed": item.listed,
        "media_condition": item.media_condition,
        "sleeve_condition": item.sleeve_condition,
        "location": item.location,
        "external_id": item.external_id,
        "comments": item.comments,
        "quantity": item.quantity,
        "status": item.status,
        "release_id": str(item.release_id) if item.release_id else "",
    }


@router.get("")
async def get_inventory(
    status: str | None = None,
    q: str | None = None,
    media_type: str | None = None,
    format_desc: str | None = None,
    media_condition: str | None = None,
    sleeve_condition: str | None = None,
    location: str | None = None,
    genre: str | None = None,
    style: str | None = None,
    year: str | None = None,
    price_min: float | None = None,
    price_max: float | None = None,
    sort: str = "listed_desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
):
    filters = {
        "status": status, "q": q, "media_type": media_type,
        "format_desc": format_desc, "media_condition": media_condition,
        "sleeve_condition": sleeve_condition, "location": location,
        "genre": genre, "style": style, "year": year,
        "price_min": price_min, "price_max": price_max,
    }
    start = (page - 1) * page_size
    total, items = await _svc.query(filters, sort=sort, offset=start, limit=page_size)
    return {"total": total, "items": items, "page": page, "page_size": page_size}


# ── Facets (conteggi filtri) ────────────────────────────────────────────────────

@router.get("/facets")
async def get_facets(status: str | None = None, q: str | None = None):
    return await _svc.facets(status=status, q=q)


# ── Arricchimento Genre/Style/Year ─────────────────────────────────────────────

@router.get("/enrich-status")
async def enrich_status():
    return await _svc.enrich_progress()


@router.post("/enrich-batch")
async def enrich_batch_ep(size: int = Query(40, ge=1, le=55)):
    if not settings.DISCOGS_TOKEN:
        raise HTTPException(400, "DISCOGS_TOKEN non configurato")
    ids = await _svc.unenriched_release_ids(limit=size)
    if not ids:
        return {"processed": 0, "remaining": 0, "done": True}
    try:
        await enrich_batch(settings.DISCOGS_TOKEN, ids, settings.INVENTORY_CSV_DIR)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")
    await _svc.reload()
    prog = await _svc.enrich_progress()
    return {"processed": len(ids), "remaining": prog["remaining"], "done": prog["remaining"] == 0}


# ── Sync da Discogs ────────────────────────────────────────────────────────────

@router.post("/sync")
async def sync_from_discogs():
    if not settings.DISCOGS_TOKEN:
        raise HTTPException(400, "DISCOGS_TOKEN non configurato nel .env del server")
    try:
        result = await sync_inventory(settings.DISCOGS_TOKEN, settings.INVENTORY_CSV_DIR)
    except TimeoutError as e:
        raise HTTPException(504, str(e))
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")
    await _svc.reload()
    return result


# ── Lookup release da URL Discogs ──────────────────────────────────────────────

@router.get("/lookup-url")
async def lookup_discogs_url(url: str):
    if not settings.DISCOGS_TOKEN:
        raise HTTPException(400, "DISCOGS_TOKEN non configurato")
    try:
        return await lookup_release(settings.DISCOGS_TOKEN, url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")


# ── Next listing ID ────────────────────────────────────────────────────────────

@router.get("/next-listing-id")
async def next_listing_id(mode: str = "nod_unoff", db: AsyncSession = Depends(get_db)):
    prefix = "80808" if mode == "nod_unoff" else "303030"
    fallback = int(f"{prefix}00001")

    stmt = select(func.max(InventoryItem.listing_id)).where(
        InventoryItem.listing_id.like(f"{prefix}%")
    )
    result = await db.execute(stmt)
    max_id = result.scalar()
    if max_id:
        try:
            return {"next_id": str(int(max_id) + 1)}
        except Exception:
            pass
    return {"next_id": str(fallback)}


# ── Dropdown options ───────────────────────────────────────────────────────────

@router.get("/dropdown-options")
async def dropdown_options():
    return {
        "media_conditions": _MEDIA_CONDITIONS,
        "sleeve_conditions": _SLEEVE_CONDITIONS,
        "locations": _LOCATIONS,
        "statuses": ["For Sale", "Draft", "Expired"],
    }


# ── Add inventory item ─────────────────────────────────────────────────────────

class AddInventoryItem(BaseModel):
    mode: str  # "nod_unoff" | "inv_os"
    listing_id: str
    url_discogs: str = ""
    release_id: int | None = None
    artist: str = ""
    title: str = ""
    label: str = ""
    catno: str = ""
    format: str = ""
    format_quantity: int = 0
    status: str = "For Sale"
    price: float
    location: str = "UNOFF"
    media_condition: str = ""
    sleeve_condition: str = ""
    comments: str = ""
    external_id: str = ""
    weight: int | None = None
    accept_offer: str = "N"
    country: str = ""
    year: str = ""
    genere: str = ""
    stile: str = ""
    costo_unitario: float | None = None


@router.post("/items")
async def add_inventory_item(body: AddInventoryItem, db: AsyncSession = Depends(get_db)):
    # Verifica che listing_id non esista già
    existing = await db.execute(
        select(InventoryItem).where(InventoryItem.listing_id == body.listing_id)
    )
    if existing.scalar():
        raise HTTPException(409, f"Listing ID {body.listing_id} già esistente")

    source = "NOD-UnOff" if body.mode == "nod_unoff" else "OS Records"
    item = InventoryItem(
        listing_id=body.listing_id,
        mode=body.mode,
        source=source,
        url_discogs=body.url_discogs,
        release_id=body.release_id,
        artist=body.artist,
        title=body.title,
        label=body.label,
        catno=body.catno,
        format=body.format,
        format_quantity=body.format_quantity,
        status=body.status,
        price=body.price,
        listed=datetime.now().strftime("%d/%m/%Y %H:%M"),
        location=body.location,
        media_condition=body.media_condition,
        sleeve_condition=body.sleeve_condition,
        comments=body.comments,
        external_id=body.external_id,
        weight=body.weight,
        accept_offer=body.accept_offer,
        quantity=1,
        country=body.country,
        year=body.year,
        genere=body.genere,
        stile=body.stile,
        costo_unitario=body.costo_unitario,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {"id": item.id, "listing_id": item.listing_id}
