from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import settings
from app.database import get_db
from app.models.inventory_item import InventoryItem
from app.models.release_meta import ReleaseMeta
from app.models.release_sales import ReleaseSales
from app.services.discogs_enrich_service import fetch_release_meta
from app.services.discogs_scraper_service import DiscogsScraper
from app.services.discogs_lookup_service import lookup_release
from app.services.discogs_sync_service import sync_inventory
from app.services.inventory_service import InventoryService

router = APIRouter(
    prefix="/api/v1/inventory",
    tags=["inventory"],
    dependencies=[Depends(get_current_user)],
)

_svc = InventoryService()


async def _sync_meta(db: AsyncSession) -> None:
    """Sincronizza il dict metadati in memoria con la tabella release_meta.
    Confronta COUNT(*) (veloce) per rilevare modifiche fatte da altri worker.
    """
    from app.services import inventory_service as _is
    count = (await db.execute(select(func.count()).select_from(ReleaseMeta))).scalar_one()
    if count == len(_is._META):
        return
    rows = (await db.execute(
        select(ReleaseMeta.release_id, ReleaseMeta.genre, ReleaseMeta.style, ReleaseMeta.year)
    )).all()
    meta = {r[0]: {"genre": r[1] or "", "style": r[2] or "", "year": r[3] or ""} for r in rows}
    _svc.set_meta(meta)

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
    db: AsyncSession = Depends(get_db),
):
    await _sync_meta(db)
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
async def get_facets(status: str | None = None, q: str | None = None,
                     db: AsyncSession = Depends(get_db)):
    await _sync_meta(db)
    return await _svc.facets(status=status, q=q)


# ── Arricchimento Genre/Style/Year (tabella release_meta) ──────────────────────

@router.get("/enrich-status")
async def enrich_status(db: AsyncSession = Depends(get_db)):
    await _sync_meta(db)
    return await _svc.enrich_progress()


@router.post("/enrich-batch")
async def enrich_batch_ep(size: int = Query(40, ge=1, le=55),
                          db: AsyncSession = Depends(get_db)):
    if not settings.DISCOGS_TOKEN:
        raise HTTPException(400, "DISCOGS_TOKEN non configurato")
    await _sync_meta(db)
    ids = await _svc.unenriched_release_ids(limit=size)
    if not ids:
        return {"processed": 0, "remaining": 0, "done": True}

    try:
        metas = await fetch_release_meta(settings.DISCOGS_TOKEN, ids)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")

    # Upsert nella tabella release_meta
    for m in metas:
        await db.merge(ReleaseMeta(**m))
    await db.commit()

    await _sync_meta(db)
    prog = await _svc.enrich_progress()
    return {"processed": len(metas), "remaining": prog["remaining"], "done": prog["remaining"] == 0}


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


# ── Vendite & Mercato (scraping Discogs) ───────────────────────────────────────

def _sales_to_dict(s: ReleaseSales) -> dict:
    return {
        "release_id": s.release_id,
        "sales_count": s.sales_count,
        "min_price": s.min_price, "max_price": s.max_price,
        "median_price": s.median_price, "avg_price": s.avg_price,
        "last_sold_price": s.last_sold_price, "last_sold_date": s.last_sold_date,
        "have": s.have, "want": s.want, "avg_rating": s.avg_rating,
        "ratings_count": s.ratings_count, "items_for_sale": s.items_for_sale,
        "sales_history": s.sales_history or [],
        "market_listings": s.market_listings or [],
        "sales_scraped_at": s.sales_scraped_at.isoformat() if s.sales_scraped_at else None,
        "market_scraped_at": s.market_scraped_at.isoformat() if s.market_scraped_at else None,
    }


async def _save_scrape(db: AsyncSession, release_id: str, data: dict) -> ReleaseSales:
    now = datetime.now()
    row = await db.get(ReleaseSales, str(release_id)) or ReleaseSales(release_id=str(release_id))
    row.sales_count = data.get("sales_count", 0)
    row.min_price = data.get("min_price")
    row.max_price = data.get("max_price")
    row.median_price = data.get("median_price")
    row.avg_price = data.get("avg_price")
    row.last_sold_price = data.get("last_sold_price")
    row.last_sold_date = data.get("last_sold_date", "") or ""
    row.have = data.get("have")
    row.want = data.get("want")
    row.avg_rating = data.get("avg_rating")
    row.ratings_count = data.get("ratings_count")
    row.items_for_sale = data.get("items_for_sale")
    row.sales_history = data.get("sales_history", [])
    row.market_listings = data.get("market_listings", [])
    row.sales_scraped_at = now
    row.market_scraped_at = now
    await db.merge(row)
    await db.commit()
    return row


@router.get("/discogs/session-status")
async def discogs_session_status():
    return {
        "credentials_set": bool(settings.DISCOGS_USERNAME and settings.DISCOGS_PASSWORD),
        "session_saved": os.path.exists(settings.DISCOGS_STATE_PATH),
    }


@router.get("/releases/{release_id}/sales")
async def get_release_sales(release_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(ReleaseSales, str(release_id))
    if not row:
        return {"release_id": release_id, "scraped": False}
    return {"scraped": True, **_sales_to_dict(row)}


def _can_scrape() -> None:
    if not settings.DISCOGS_USERNAME and not os.path.exists(settings.DISCOGS_STATE_PATH):
        raise HTTPException(400,
            "Nessuna sessione Discogs: configura DISCOGS_USERNAME/PASSWORD nel .env "
            "oppure carica i cookie con scripts/discogs_login_local.py")


@router.post("/releases/{release_id}/scrape-sales")
async def scrape_release_sales(release_id: str, db: AsyncSession = Depends(get_db)):
    _can_scrape()
    try:
        async with DiscogsScraper() as scraper:
            data = await scraper.scrape_release(release_id)
    except Exception as e:
        raise HTTPException(502, f"Errore scraping Discogs: {e}")
    row = await _save_scrape(db, release_id, data)
    return {"scraped": True, **_sales_to_dict(row)}


class BatchScrapeBody(BaseModel):
    release_ids: list[str]


@router.post("/scrape-sales-batch")
async def scrape_sales_batch(body: BatchScrapeBody, db: AsyncSession = Depends(get_db)):
    """Scrapa un chunk di release in una sola sessione browser. Il frontend
    chiama in loop con chunk piccoli (es. 5-10) mostrando il progresso."""
    _can_scrape()
    ids = [r for r in body.release_ids if r]
    if not ids:
        return {"processed": 0}
    processed = 0
    try:
        async with DiscogsScraper() as scraper:
            await scraper._ensure_login()
            for rid in ids:
                try:
                    data = await scraper.scrape_release(rid, do_login_check=False)
                    await _save_scrape(db, rid, data)
                    processed += 1
                except Exception:
                    pass
    except Exception as e:
        raise HTTPException(502, f"Errore scraping Discogs: {e}")
    return {"processed": processed}


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
