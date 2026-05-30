from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.daily_closure import DailyClosure
from app.schemas.daily_closure import ClosureCreate, ClosureRead

router = APIRouter(
    prefix="/api/v1/closures",
    tags=["closures"],
    dependencies=[Depends(get_current_user)],
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
    cl = DailyClosure(**payload.model_dump(), differenza=diff)
    db.add(cl)
    await db.flush()
    await db.refresh(cl)
    return cl
