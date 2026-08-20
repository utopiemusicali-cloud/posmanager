from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.config import settings
from app.database import get_company_session_maker, get_db
from app.models.company_settings import CompanySettings
from app.models.inventory_event import InventoryEvent
from app.models.inventory_item import InventoryItem
from app.models.release_meta import ReleaseMeta
from app.models.release_sales import ReleaseSales
from app.models.user import User
from app.services import discogs_push_worker, enrich_worker, inventory_event_service
from app.services.discogs_scraper_service import DiscogsScraper
from app.services.discogs_lookup_service import lookup_release
from app.services.discogs_sync_service import sync_inventory
from app.services.inventory_import_service import import_discogs_csv
from app.services.inventory_service import InventoryService, get_inventory_service

router = APIRouter(
    prefix="/api/v1/inventory",
    tags=["inventory"],
    dependencies=[Depends(get_current_user)],
)


def _db_name(current_user: User) -> str:
    return current_user._company_db or settings.default_company_db


async def _company_discogs_token(db: AsyncSession) -> str | None:
    """Token Discogs dell'azienda corrente (company_settings_integrations).
    Fallback su DISCOGS_TOKEN globale solo per retrocompatibilità (azienda di default)."""
    cs = (await db.execute(select(CompanySettings))).scalars().first()
    return (cs.discogs_token if cs else None) or settings.DISCOGS_TOKEN


async def _sync_meta(svc: InventoryService, db: AsyncSession) -> None:
    """Sincronizza il dict metadati in memoria (dell'azienda corrente) con la
    tabella release_meta del suo DB. Confronta COUNT(*) (veloce) per rilevare
    modifiche fatte da altri worker."""
    count = (await db.execute(select(func.count()).select_from(ReleaseMeta))).scalar_one()
    if count == len(svc._meta):
        return
    rows = (await db.execute(
        select(ReleaseMeta.release_id, ReleaseMeta.genre, ReleaseMeta.style, ReleaseMeta.year)
    )).all()
    meta = {r[0]: {"genre": r[1] or "", "style": r[2] or "", "year": r[3] or ""} for r in rows}
    svc.set_meta(meta)

_MEDIA_CONDITIONS = [
    "Mint (M)", "Near Mint (NM or M-)", "Very Good Plus (VG+)",
    "Very Good (VG)", "Good Plus (G+)", "Good (G)", "Fair (F)", "Poor (P)",
]
_SLEEVE_CONDITIONS = _MEDIA_CONDITIONS + ["Generic", "Not Graded", "No Cover"]
_LOCATIONS = ["UNOFF", "OS Records", "Deposito"]


# ── GET inventory (da MySQL, inventory_items) ──────────────────────────────────

@router.get("")
async def get_inventory(
    status: str | None = None,
    source: str | None = None,
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = get_inventory_service(_db_name(current_user))
    await _sync_meta(svc, db)
    filters = {
        "status": status, "source": source, "q": q, "media_type": media_type,
        "format_desc": format_desc, "media_condition": media_condition,
        "sleeve_condition": sleeve_condition, "location": location,
        "genre": genre, "style": style, "year": year,
        "price_min": price_min, "price_max": price_max,
    }
    start = (page - 1) * page_size
    total, items = await svc.query(filters, sort=sort, offset=start, limit=page_size)
    return {"total": total, "items": items, "page": page, "page_size": page_size}


# ── Facets (conteggi filtri) ────────────────────────────────────────────────────

@router.get("/facets")
async def get_facets(status: str | None = None, q: str | None = None,
                     current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    svc = get_inventory_service(_db_name(current_user))
    await _sync_meta(svc, db)
    return await svc.facets(status=status, q=q)


# ── Arricchimento Genre/Style/Year (tabella release_meta) ──────────────────────

async def _fully_enriched_ids(db: AsyncSession) -> set[str]:
    """release_id che hanno già i dati COMPLETI (raw_json presente)."""
    rows = await db.execute(
        select(ReleaseMeta.release_id).where(ReleaseMeta.raw_json.isnot(None))
    )
    return {r[0] for r in rows.all()}


@router.get("/enrich-status")
async def enrich_status(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    db_name = _db_name(current_user)
    svc = get_inventory_service(db_name)
    ids = {str(r) for r in await svc.unique_release_ids()}
    done = await _fully_enriched_ids(db)
    enriched = len(ids & done)
    st = enrich_worker.read_state(db_name)
    return {
        "total": len(ids), "enriched": enriched, "remaining": len(ids) - enriched,
        "running": enrich_worker.is_running(db_name), "error": st.get("error", ""),
    }


@router.post("/enrich-start")
async def enrich_start(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Avvia l'arricchimento come task di background sul server (autonomo)."""
    db_name = _db_name(current_user)
    svc = get_inventory_service(db_name)
    token = await _company_discogs_token(db)
    if not token:
        raise HTTPException(400, "Discogs token non configurato. Vai su Impostazioni > Integrazioni.")
    if enrich_worker.is_running(db_name):
        return {"started": False, "already_running": True}
    ids = [str(r) for r in await svc.unique_release_ids()]
    asyncio.create_task(enrich_worker.run_enrich(db_name, token, ids))
    return {"started": True}


@router.post("/enrich-stop")
async def enrich_stop(current_user: User = Depends(get_current_user)):
    db_name = _db_name(current_user)
    enrich_worker.request_stop(db_name)
    return {"ok": True}


# ── Sync da Discogs ────────────────────────────────────────────────────────────

@router.post("/sync")
async def sync_from_discogs(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Scarica l'export Discogs, ne salva sempre una copia CSV su disco
    (archivio per-azienda) e importa i listing nel DB (inventory_items)."""
    db_name = _db_name(current_user)
    token = await _company_discogs_token(db)
    if not token:
        raise HTTPException(400, "Discogs token non configurato. Vai su Impostazioni > Integrazioni.")
    csv_dir = os.path.join(settings.INVENTORY_CSV_DIR, db_name)
    try:
        result = await sync_inventory(token, csv_dir)
    except TimeoutError as e:
        raise HTTPException(504, str(e))
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")

    csv_path = os.path.join(csv_dir, result["filename"])
    import_stats = await import_discogs_csv(get_company_session_maker(db_name), csv_path)

    await get_inventory_service(db_name).reload()
    return {**result, **import_stats}


# ── Lookup release da URL Discogs ──────────────────────────────────────────────

@router.get("/lookup-url")
async def lookup_discogs_url(url: str, db: AsyncSession = Depends(get_db)):
    token = await _company_discogs_token(db)
    if not token:
        raise HTTPException(400, "Discogs token non configurato. Vai su Impostazioni > Integrazioni.")
    try:
        return await lookup_release(token, url)
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


class SalesIngest(BaseModel):
    sales_count: int = 0
    min_price: float | None = None
    max_price: float | None = None
    median_price: float | None = None
    avg_price: float | None = None
    last_sold_price: float | None = None
    last_sold_date: str = ""
    have: int | None = None
    want: int | None = None
    avg_rating: float | None = None
    ratings_count: int | None = None
    items_for_sale: int | None = None
    sales_history: list = []
    market_listings: list = []


@router.post("/releases/{release_id}/sales-ingest")
async def ingest_release_sales(release_id: str, body: SalesIngest,
                               db: AsyncSession = Depends(get_db)):
    """Riceve i dati vendita/mercato scrapati dallo script LOCALE e li salva."""
    row = await _save_scrape(db, release_id, body.model_dump())
    return {"ok": True, "release_id": release_id, **_sales_to_dict(row)}


@router.get("/sales-todo")
async def sales_todo(status: str = "For Sale", limit: int = Query(500, ge=1, le=20000),
                     current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    """Lista release_id in inventario che NON hanno ancora dati vendita.
    Lo script locale la usa per sapere cosa scrapare."""
    svc = get_inventory_service(_db_name(current_user))
    ids = await svc.unique_release_ids()
    if status:
        # filtra per status: prendi release_id che compaiono in quel tab
        _total, items = await svc.query({"status": status}, limit=20000)
        status_ids = {str(i.get("release_id")) for i in items if i.get("release_id")}
        ids = [r for r in ids if str(r) in status_ids]
    existing = {row[0] for row in (await db.execute(select(ReleaseSales.release_id))).all()}
    todo = [str(r) for r in ids if str(r) not in existing]
    return {"total_inventory": len(ids), "already_scraped": len(existing), "todo": todo[:limit]}


@router.get("/discogs/session-status")
async def discogs_session_status():
    return {
        "credentials_set": bool(settings.DISCOGS_USERNAME and settings.DISCOGS_PASSWORD),
        "session_saved": os.path.exists(settings.DISCOGS_STATE_PATH),
    }


@router.get("/releases/{release_id}/meta")
async def get_release_meta_full(release_id: str, db: AsyncSession = Depends(get_db)):
    """Metadati enrichment (release_meta) + estratti dal raw_json (tracklist, immagini, video)."""
    import json
    row = await db.get(ReleaseMeta, str(release_id))
    if not row:
        return {"found": False}
    raw = {}
    if row.raw_json:
        try:
            raw = json.loads(row.raw_json)
        except Exception:
            raw = {}
    return {
        "found": True,
        "artist": row.artist, "title": row.title, "label": row.label, "catno": row.catno,
        "format": row.format, "year": row.year, "country": row.country, "released": row.released,
        "genre": row.genre, "style": row.style, "barcode": row.barcode, "master_id": row.master_id,
        "thumbnail": row.thumbnail, "cover_image": row.cover_image,
        "have": row.have, "want": row.want, "rating_avg": row.rating_avg,
        "rating_count": row.rating_count, "num_for_sale": row.num_for_sale,
        "lowest_price": row.lowest_price, "notes": row.notes,
        "tracklist": [
            {"position": t.get("position", ""), "title": t.get("title", ""), "duration": t.get("duration", "")}
            for t in (raw.get("tracklist") or [])
        ],
        "images": [
            {"uri": i.get("uri", ""), "thumb": i.get("uri150", i.get("uri", ""))}
            for i in (raw.get("images") or [])
        ],
        "videos": [
            {"uri": v.get("uri", ""), "title": v.get("title", "")}
            for v in (raw.get("videos") or [])
        ],
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
    add_date: str = ""
    weight: int | None = None
    accept_offer: str = "N"
    country: str = ""
    year: str = ""
    genere: str = ""
    stile: str = ""
    costo_unitario: float | None = None


@router.post("/items")
async def add_inventory_item(body: AddInventoryItem,
                             current_user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
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
        add_date=body.add_date,
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
    await inventory_event_service.record_simple(
        db, listing_id=body.listing_id, event_type="created", source="ui",
        user_id=current_user.id, username=current_user.username,
        note=f"{source} · {body.artist} — {body.title}".strip(" ·"),
    )
    await db.commit()
    await db.refresh(item)
    return {"id": item.id, "listing_id": item.listing_id}


# ── Modifica rapida da tabella (prezzo, condizioni, location, note...) ─────────

# Campi che esistono anche sull'inserzione Discogs: modificarli mette l'item
# in coda per il push verso il marketplace. costo_unitario è solo interno
# (non esiste su Discogs) e non attiva mai la sincronizzazione.
_DISCOGS_FIELDS = {"price", "media_condition", "sleeve_condition", "location",
                    "external_id", "comments", "accept_offer"}


class UpdateInventoryItem(BaseModel):
    price: float | None = None
    media_condition: str | None = None
    sleeve_condition: str | None = None
    location: str | None = None
    external_id: str | None = None
    comments: str | None = None
    accept_offer: str | None = None
    costo_unitario: float | None = None


@router.patch("/items/{listing_id}")
async def update_inventory_item(
    listing_id: str,
    body: UpdateInventoryItem,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(
        select(InventoryItem).where(InventoryItem.listing_id == listing_id)
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Articolo non trovato")

    changed = body.model_dump(exclude_unset=True)

    # Il diff va calcolato PRIMA di applicare le modifiche, altrimenti
    # confronterebbe ogni valore con se stesso.
    diffs = inventory_event_service.diff_fields(item, changed)
    for field, value in changed.items():
        setattr(item, field, value)

    if diffs:
        await inventory_event_service.record(
            db, listing_id=listing_id, changes=diffs, source="ui",
            user_id=current_user.id, username=current_user.username,
        )

    # Si spinge a Discogs solo se un campo rilevante è cambiato davvero:
    # un salvataggio che non modifica nulla non deve consumare quota API.
    touched = {f for f, _, _ in diffs}
    needs_push = item.source == "Discogs" and bool(_DISCOGS_FIELDS & touched)
    if needs_push:
        item.discogs_dirty = True
        item.discogs_sync_error = ""
    await db.commit()

    db_name = _db_name(current_user)
    await get_inventory_service(db_name).reload()

    if needs_push:
        token = await _company_discogs_token(db)
        if token:
            await discogs_push_worker.trigger_if_idle(db_name, token)
    return {"ok": True}


# ── Storico modifiche (inventory_events) ──────────────────────────────────────

@router.get("/items/{listing_id}/history")
async def get_item_history(listing_id: str, limit: int = Query(200, ge=1, le=1000),
                            db: AsyncSession = Depends(get_db)):
    """Cronologia completa di un singolo articolo, dal più recente."""
    return {"events": await inventory_event_service.history_for(db, listing_id, limit)}


@router.get("/events")
async def get_events(
    event_type: str | None = None,
    field: str | None = None,
    source: str | None = None,
    listing_id: str | None = None,
    days: int | None = Query(None, ge=1, le=3650),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Feed globale degli eventi dell'azienda, con filtri. Usato dalla vista
    'Storico' per rispondere a domande tipo 'cosa è stato venduto questa
    settimana' o 'chi ha ritoccato i prezzi'."""
    stmt = select(InventoryEvent)
    count_stmt = select(func.count()).select_from(InventoryEvent)

    conditions = []
    if event_type:
        conditions.append(InventoryEvent.event_type == event_type)
    if field:
        conditions.append(InventoryEvent.field == field)
    if source:
        conditions.append(InventoryEvent.source == source)
    if listing_id:
        conditions.append(InventoryEvent.listing_id == listing_id)
    if days:
        cutoff = datetime.now() - timedelta(days=days)
        conditions.append(InventoryEvent.created_at >= cutoff)
    if conditions:
        stmt = stmt.where(*conditions)
        count_stmt = count_stmt.where(*conditions)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(
        stmt.order_by(InventoryEvent.created_at.desc(), InventoryEvent.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "total": total, "page": page, "page_size": page_size,
        "events": [inventory_event_service.to_dict(e) for e in rows],
    }


# ── Sincronizzazione modifiche verso Discogs (coda in background) ──────────────

@router.get("/discogs-push-status")
async def discogs_push_status(current_user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    db_name = _db_name(current_user)
    pending = (await db.execute(
        select(func.count()).select_from(InventoryItem).where(
            InventoryItem.source == "Discogs",
            InventoryItem.discogs_dirty.is_(True),
        )
    )).scalar_one()
    st = discogs_push_worker.read_state(db_name)
    return {
        "pending": pending,
        "running": discogs_push_worker.is_running(db_name),
        "processed": st.get("processed", 0),
        "total": st.get("total", 0),
        "errors": st.get("errors", 0),
    }


@router.post("/discogs-push-stop")
async def discogs_push_stop(current_user: User = Depends(get_current_user)):
    discogs_push_worker.request_stop(_db_name(current_user))
    return {"ok": True}
