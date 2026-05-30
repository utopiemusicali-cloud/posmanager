from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.dialects.mysql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.digital_transaction import DigitalTransaction
from app.schemas.common import PaginatedResponse
from app.schemas.digital_transaction import TransactionRead, TransactionUpsert

router = APIRouter(
    prefix="/api/v1/transactions",
    tags=["transactions"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=PaginatedResponse[TransactionRead])
async def list_transactions(
    fonte: str | None = None,
    da: datetime | None = None,
    a: datetime | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(DigitalTransaction)
    if fonte:
        q = q.where(DigitalTransaction.fonte == fonte)
    if da:
        q = q.where(DigitalTransaction.data >= da)
    if a:
        q = q.where(DigitalTransaction.data <= a)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (
        await db.execute(
            q.order_by(DigitalTransaction.data.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return PaginatedResponse(total=total, items=rows, page=page, page_size=page_size)


@router.post("/upsert", response_model=dict)
async def upsert_transactions(
    items: list[TransactionUpsert],
    db: AsyncSession = Depends(get_db),
):
    """Inserisce o aggiorna transazioni (INSERT ... ON DUPLICATE KEY UPDATE)."""
    inserted = 0
    for item in items:
        stmt = (
            insert(DigitalTransaction)
            .values(**item.model_dump())
            .on_duplicate_key_update(**item.model_dump(exclude={"fonte", "transaction_id"}))
        )
        await db.execute(stmt)
        inserted += 1
    return {"processed": inserted}
