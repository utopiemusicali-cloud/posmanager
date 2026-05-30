from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.cost_center import CATEGORIE, CostCenter
from app.schemas.common import MessageResponse
from app.schemas.cost_center import CostCenterCreate, CostCenterRead, CostCenterSummary

router = APIRouter(
    prefix="/api/v1/cost-centers",
    tags=["cost-centers"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/categories", response_model=list[str])
async def get_categories():
    return CATEGORIE


@router.get("", response_model=list[CostCenterRead])
async def list_cost_centers(
    da: datetime | None = None,
    a: datetime | None = None,
    categoria: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    q = select(CostCenter)
    if da:
        q = q.where(CostCenter.data >= da)
    if a:
        q = q.where(CostCenter.data <= a)
    if categoria:
        q = q.where(CostCenter.categoria == categoria)
    rows = (
        await db.execute(q.order_by(CostCenter.data.desc()).limit(limit))
    ).scalars().all()
    return rows


@router.post("", response_model=CostCenterRead, status_code=status.HTTP_201_CREATED)
async def create_cost_center(payload: CostCenterCreate, db: AsyncSession = Depends(get_db)):
    cc = CostCenter(**payload.model_dump())
    db.add(cc)
    await db.flush()
    await db.refresh(cc)
    return cc


@router.delete("/{id}", response_model=MessageResponse)
async def delete_cost_center(id: int, db: AsyncSession = Depends(get_db)):
    cc = await db.get(CostCenter, id)
    if not cc:
        raise HTTPException(status_code=404, detail="Non trovato")
    await db.delete(cc)
    return MessageResponse(message=f"Voce {id} eliminata")


@router.get("/summary", response_model=list[CostCenterSummary])
async def get_summary(
    da: datetime | None = None,
    a: datetime | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(CostCenter.categoria, func.sum(CostCenter.importo).label("totale"))
    if da:
        q = q.where(CostCenter.data >= da)
    if a:
        q = q.where(CostCenter.data <= a)
    q = q.group_by(CostCenter.categoria).order_by(CostCenter.categoria)
    rows = (await db.execute(q)).all()
    return [CostCenterSummary(categoria=r.categoria, totale=Decimal(str(r.totale))) for r in rows]
