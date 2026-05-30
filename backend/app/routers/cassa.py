from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.cash_movement import CashMovement
from app.models.deletion_log import DeletionLog
from app.models.user import User
from app.schemas.cash_movement import CashMovementCreate, CashMovementRead, CashMovementUpdate
from app.schemas.common import MessageResponse, PaginatedResponse

router = APIRouter(
    prefix="/api/v1/cassa",
    tags=["cassa"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/movimenti", response_model=PaginatedResponse[CashMovementRead])
async def list_movimenti(
    da: datetime | None = None,
    a: datetime | None = None,
    metodo: str | None = None,
    utente: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(CashMovement)
    if da:
        q = q.where(CashMovement.movement_ts >= da)
    if a:
        q = q.where(CashMovement.movement_ts <= a)
    if metodo:
        q = q.where(CashMovement.metodo_pagamento == metodo)
    if utente:
        q = q.where(CashMovement.utente == utente)

    total_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(total_q)).scalar_one()

    q = q.order_by(CashMovement.movement_ts.desc())
    q = q.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(q)).scalars().all()
    return PaginatedResponse(total=total, items=rows, page=page, page_size=page_size)


@router.post("/movimenti", response_model=CashMovementRead, status_code=status.HTTP_201_CREATED)
async def create_movimento(
    payload: CashMovementCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mov = CashMovement(**payload.model_dump())
    db.add(mov)
    await db.flush()
    await _aggiorna_saldi(db)
    await db.refresh(mov)
    return mov


@router.patch("/movimenti/{id}", response_model=CashMovementRead)
async def update_movimento(
    id: int,
    payload: CashMovementUpdate,
    db: AsyncSession = Depends(get_db),
):
    mov = await db.get(CashMovement, id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimento non trovato")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(mov, k, v)
    await db.flush()
    await _aggiorna_saldi(db)
    await db.refresh(mov)
    return mov


@router.delete("/movimenti/{id}", response_model=MessageResponse)
async def delete_movimento(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mov = await db.get(CashMovement, id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimento non trovato")
    log = DeletionLog(
        utente_eliminazione=current_user.username,
        tipo_operazione="Cassa Contante",
        data_operazione=mov.movement_ts.isoformat(),
        utente_operazione=mov.utente,
        nota=mov.nota,
        importo=mov.importo,
        saldo=mov.saldo,
        fornitore=mov.fornitore,
    )
    db.add(log)
    await db.delete(mov)
    await db.flush()
    await _aggiorna_saldi(db)
    return MessageResponse(message=f"Movimento {id} eliminato")


@router.get("/saldo", response_model=dict)
async def get_saldo(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CashMovement.saldo)
        .order_by(CashMovement.movement_ts.desc(), CashMovement.id.desc())
        .limit(1)
    )
    saldo = result.scalar_one_or_none() or Decimal("0")
    return {"saldo": saldo}


async def _aggiorna_saldi(db: AsyncSession) -> None:
    """Ricalcola i saldi progressivi di tutti i movimenti ordinati per data."""
    rows = (
        await db.execute(
            select(CashMovement).order_by(CashMovement.movement_ts, CashMovement.id)
        )
    ).scalars().all()
    saldo = Decimal("0")
    for row in rows:
        saldo += row.importo
        row.saldo = saldo
