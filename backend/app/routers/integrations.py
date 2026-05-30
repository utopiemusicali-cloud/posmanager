from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.config import settings
from app.services.discogs_orders_service import (
    ORDER_STATUSES, cancel_order, fetch_all_orders, fetch_orders,
    get_order_messages, mark_as_shipped,
)

router = APIRouter(
    prefix="/api/v1/integrations",
    tags=["integrations"],
    dependencies=[Depends(get_current_user)],
)


def _require_token():
    if not settings.DISCOGS_TOKEN:
        raise HTTPException(400, "DISCOGS_TOKEN non configurato nel .env del server")
    return settings.DISCOGS_TOKEN


# ── Ordini paginati (default) ──────────────────────────────────────────────────

@router.get("/discogs/orders")
async def get_discogs_orders(
    status: str = Query("All"),
    sort_order: str = Query("desc"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    token = _require_token()
    try:
        return await fetch_orders(token, status, sort_order, page, per_page)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")


# ── Tutti gli ordini per anno (con statistiche) ───────────────────────────────

@router.get("/discogs/orders/year/{year}")
async def get_discogs_orders_year(year: int):
    token = _require_token()
    try:
        orders = await fetch_all_orders(token, year)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")

    # Raggruppa per mese
    by_month: dict[str, list] = {}
    for o in orders:
        created = o.get("created", "")
        if created:
            month_key = created[:7]  # "2026-01"
            by_month.setdefault(month_key, []).append(o)

    return {"orders": orders, "by_month": by_month, "total": len(orders)}


# ── Messaggi ordine ────────────────────────────────────────────────────────────

@router.get("/discogs/orders/{order_id}/messages")
async def get_messages(order_id: str):
    token = _require_token()
    try:
        msgs = await get_order_messages(token, order_id)
        return {"messages": msgs}
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")


class SendMessagePayload(BaseModel):
    message: str


@router.post("/discogs/orders/{order_id}/messages")
async def send_message(order_id: str, body: SendMessagePayload):
    """Invia un messaggio all'acquirente senza cambiare lo status dell'ordine."""
    token = _require_token()
    if not body.message.strip():
        raise HTTPException(400, "Messaggio vuoto")
    headers = {
        "Authorization": f"Discogs token={token}",
        "Content-Type": "application/json",
        "User-Agent": "posmanager/1.0",
    }
    import httpx
    async with httpx.AsyncClient(headers=headers, timeout=20) as client:
        resp = await client.post(
            f"https://api.discogs.com/marketplace/orders/{order_id}/messages",
            json={"message": body.message},
        )
    if resp.status_code == 201:
        return {"ok": True}
    raise HTTPException(502, f"Discogs ha risposto con {resp.status_code}")


# ── Segna come spedito ─────────────────────────────────────────────────────────

class ShipPayload(BaseModel):
    tracking: str
    buyer: str = ""
    shipping_method: str = ""


@router.post("/discogs/orders/{order_id}/ship")
async def ship_order(order_id: str, body: ShipPayload):
    token = _require_token()
    if not body.tracking.strip():
        raise HTTPException(400, "Numero di tracking obbligatorio")
    try:
        ok = await mark_as_shipped(token, order_id, body.tracking, body.buyer, body.shipping_method)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")
    if not ok:
        raise HTTPException(500, "Discogs ha rifiutato la richiesta")
    return {"ok": True}


# ── Cancella ordine ────────────────────────────────────────────────────────────

class CancelPayload(BaseModel):
    reason: str


@router.post("/discogs/orders/{order_id}/cancel")
async def cancel_discogs_order(order_id: str, body: CancelPayload):
    token = _require_token()
    try:
        ok = await cancel_order(token, order_id, body.reason)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")
    if not ok:
        raise HTTPException(500, "Discogs ha rifiutato la richiesta")
    return {"ok": True}


# ── Immagini di un release ────────────────────────────────────────────────────

@router.get("/discogs/releases/{release_id}/images")
async def get_release_images(release_id: int):
    token = _require_token()
    import httpx
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": "posmanager/1.0"}
    async with httpx.AsyncClient(headers=headers, timeout=15) as c:
        resp = await c.get(f"https://api.discogs.com/releases/{release_id}")
        resp.raise_for_status()
        data = resp.json()
    images = [
        {"uri": img["uri"], "thumb": img.get("uri150", img["uri"])}
        for img in data.get("images", [])
        if img.get("uri")
    ]
    return {"images": images, "title": data.get("title", ""), "year": data.get("year", "")}


# ── Statuses disponibili ───────────────────────────────────────────────────────

@router.get("/discogs/order-statuses")
async def get_order_statuses():
    return {"statuses": ORDER_STATUSES}


# ── Stub SumUp / PayPal ────────────────────────────────────────────────────────

@router.get("/sumup/sync")
async def sync_sumup():
    return {"status": "not_implemented"}


@router.get("/paypal/sync")
async def sync_paypal():
    return {"status": "not_implemented"}
