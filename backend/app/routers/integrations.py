from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_user
from app.config import settings
from app.services.discogs_orders_service import fetch_orders, ORDER_STATUSES

router = APIRouter(
    prefix="/api/v1/integrations",
    tags=["integrations"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/discogs/orders")
async def get_discogs_orders(
    status: str = Query("All"),
    sort_order: str = Query("desc"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    if not settings.DISCOGS_TOKEN:
        raise HTTPException(400, "DISCOGS_TOKEN non configurato nel .env del server")
    try:
        return await fetch_orders(
            token=settings.DISCOGS_TOKEN,
            status=status,
            sort_order=sort_order,
            page=page,
            per_page=per_page,
        )
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")


@router.get("/discogs/order-statuses")
async def get_order_statuses():
    return {"statuses": ORDER_STATUSES}


@router.get("/sumup/sync")
async def sync_sumup():
    return {"status": "not_implemented"}


@router.get("/paypal/sync")
async def sync_paypal():
    return {"status": "not_implemented"}
