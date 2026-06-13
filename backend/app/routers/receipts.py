from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.receipt_payment import ReceiptPayment
from app.models.shop_receipt import ShopReceipt
from app.schemas.common import PaginatedResponse
from app.schemas.shop_receipt import NextReceiptNumber, ReceiptCreate, ReceiptRead

router = APIRouter(
    prefix="/api/v1/receipts",
    tags=["receipts"],
    dependencies=[Depends(get_current_user)],
)

_WITH_PAYMENTS = selectinload(ShopReceipt.payments)


def _base_query(
    da: datetime | None,
    a: datetime | None,
    metodo: str | None,
    customer_id: int | None,
):
    q = select(ShopReceipt)
    if da:
        q = q.where(ShopReceipt.receipt_ts >= da)
    if a:
        q = q.where(ShopReceipt.receipt_ts <= a)
    if metodo:
        # contains per trovare anche "Misto (Contanti+SumUp)" quando si filtra per "Contanti"
        q = q.where(ShopReceipt.metodo_pagamento.contains(metodo))
    if customer_id:
        q = q.where(ShopReceipt.customer_id == customer_id)
    return q


@router.get("", response_model=PaginatedResponse[ReceiptRead])
async def list_receipts(
    da: datetime | None = None,
    a: datetime | None = None,
    metodo: str | None = None,
    customer_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = _base_query(da, a, metodo, customer_id)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (
        await db.execute(
            q.options(_WITH_PAYMENTS)
            .order_by(ShopReceipt.receipt_ts.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return PaginatedResponse(total=total, items=rows, page=page, page_size=page_size)


@router.post("", response_model=ReceiptRead, status_code=status.HTTP_201_CREATED)
async def create_receipt(payload: ReceiptCreate, db: AsyncSession = Depends(get_db)):
    data = payload.model_dump(exclude={"payments"})

    # Deriva metodo_pagamento dagli split se forniti
    if payload.payments:
        if len(payload.payments) == 1:
            data["metodo_pagamento"] = payload.payments[0].metodo
        else:
            methods = "+".join(p.metodo for p in payload.payments)
            data["metodo_pagamento"] = f"Misto ({methods})"

    rec = ShopReceipt(**data)
    db.add(rec)
    await db.flush()

    for p in payload.payments:
        db.add(ReceiptPayment(receipt_id=rec.id, metodo=p.metodo, importo=p.importo))

    await db.commit()

    rec = (await db.execute(
        select(ShopReceipt).where(ShopReceipt.id == rec.id).options(_WITH_PAYMENTS)
    )).scalar_one()
    return rec


@router.get("/next-number", response_model=NextReceiptNumber)
async def next_receipt_number(db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(
            select(ShopReceipt.numero_ricevuta)
            .where(ShopReceipt.numero_ricevuta.isnot(None))
            .order_by(ShopReceipt.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row:
        try:
            return NextReceiptNumber(numero=int(str(row).strip()) + 1)
        except (ValueError, TypeError):
            pass
    return NextReceiptNumber(numero=1)


@router.get("/{id}", response_model=ReceiptRead)
async def get_receipt(id: int, db: AsyncSession = Depends(get_db)):
    rec = (await db.execute(
        select(ShopReceipt).where(ShopReceipt.id == id).options(_WITH_PAYMENTS)
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Ricevuta non trovata")
    return rec
