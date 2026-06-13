from __future__ import annotations

import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.daily_closure import DailyClosure
from app.models.receipt_payment import ReceiptPayment
from app.models.shop_receipt import ShopReceipt
from app.schemas.daily_closure import ClosureCreate, ClosurePreview, ClosureRead

router = APIRouter(
    prefix="/api/v1/closures",
    tags=["closures"],
    dependencies=[Depends(get_current_user)],
)


async def _compute_day_corrispettivi(db: AsyncSession, day: datetime) -> dict:
    """Calcola totali e canali dalle ricevute del giorno."""
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)

    # Ricevute del giorno
    receipts = (await db.execute(
        select(ShopReceipt)
        .where(ShopReceipt.receipt_ts >= start, ShopReceipt.receipt_ts < end)
        .options(selectinload(ShopReceipt.payments))
    )).scalars().all()

    totale = sum(r.total_paid for r in receipts)
    n = len(receipts)

    # Somma per canale (da receipt_payments)
    canali: dict[str, float] = {}
    for r in receipts:
        if r.payments:
            for p in r.payments:
                m = p.metodo
                canali[m] = canali.get(m, 0.0) + float(p.importo)
        elif r.metodo_pagamento:
            # fallback per ricevute senza split
            m = r.metodo_pagamento
            canali[m] = canali.get(m, 0.0) + float(r.total_paid)

    return {
        "totale_corrispettivi": float(totale),
        "n_ricevute": n,
        "canali": canali,
    }


@router.get("/preview", response_model=ClosurePreview)
async def preview_corrispettivi(
    data: datetime = Query(..., description="Giorno da calcolare (ISO datetime)"),
    db: AsyncSession = Depends(get_db),
):
    """Restituisce un'anteprima dei corrispettivi del giorno dalle ricevute, senza creare la chiusura."""
    computed = await _compute_day_corrispettivi(db, data)
    from decimal import Decimal
    return ClosurePreview(
        data=data,
        totale_corrispettivi=Decimal(str(computed["totale_corrispettivi"])),
        n_ricevute=computed["n_ricevute"],
        canali={k: Decimal(str(v)) for k, v in computed["canali"].items()},
    )


@router.get("", response_model=list[ClosureRead])
async def list_closures(
    da: datetime | None = None,
    a: datetime | None = None,
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(DailyClosure)
    if da:
        q = q.where(DailyClosure.closure_ts >= da)
    if a:
        q = q.where(DailyClosure.closure_ts <= a)
    rows = (
        await db.execute(q.order_by(DailyClosure.closure_ts.desc()).limit(limit))
    ).scalars().all()
    return rows


@router.post("", response_model=ClosureRead, status_code=status.HTTP_201_CREATED)
async def create_closure(payload: ClosureCreate, db: AsyncSession = Depends(get_db)):
    diff = payload.effettivo_cassa - payload.saldo_contabile
    data = payload.model_dump()

    # Se corrispettivi non forniti, calcolali automaticamente dalle ricevute
    if data.get("totale_corrispettivi") is None:
        computed = await _compute_day_corrispettivi(db, payload.closure_ts)
        data["totale_corrispettivi"] = computed["totale_corrispettivi"]
        data["n_ricevute"] = computed["n_ricevute"]
        if not data.get("canali_json"):
            data["canali_json"] = json.dumps(computed["canali"], ensure_ascii=False)

    cl = DailyClosure(**data, differenza=diff)
    db.add(cl)
    await db.flush()
    await db.refresh(cl)
    return cl
