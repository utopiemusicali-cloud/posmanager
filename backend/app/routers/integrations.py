from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.dependencies import get_current_user

router = APIRouter(
    prefix="/api/v1/integrations",
    tags=["integrations"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/sumup/sync")
async def sync_sumup():
    """TODO: Sincronizza transazioni SumUp."""
    return {"status": "not_implemented"}


@router.get("/paypal/sync")
async def sync_paypal():
    """TODO: Sincronizza transazioni PayPal."""
    return {"status": "not_implemented"}


@router.get("/discogs/orders")
async def get_discogs_orders(page: int = 1, per_page: int = 50):
    """TODO: Recupera ordini Discogs via API."""
    return {"status": "not_implemented"}
