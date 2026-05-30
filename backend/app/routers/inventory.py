from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.auth.dependencies import get_current_user
from app.services.inventory_service import InventoryService

router = APIRouter(
    prefix="/api/v1/inventory",
    tags=["inventory"],
    dependencies=[Depends(get_current_user)],
)

_svc = InventoryService()


@router.get("")
async def get_inventory(
    status: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
):
    """Legge inventario da CSV Discogs + file Excel locali."""
    items = await _svc.load_all(status_filter=status, search=q)
    total = len(items)
    start = (page - 1) * page_size
    return {
        "total": total,
        "items": items[start : start + page_size],
        "page": page,
        "page_size": page_size,
    }


@router.get("/reload")
async def reload_inventory():
    """Forza ricaricamento dei file CSV/Excel."""
    await _svc.reload()
    return {"ok": True}
