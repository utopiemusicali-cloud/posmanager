from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.deletion_log import DeletionLog
from app.models.expense import Expense
from app.models.user import User
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.expense import ExpenseCreate, ExpenseRead, ExpenseUpdate

router = APIRouter(
    prefix="/api/v1/expenses",
    tags=["expenses"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=PaginatedResponse[ExpenseRead])
async def list_expenses(
    da: datetime | None = None,
    a: datetime | None = None,
    tipo_spesa: str | None = None,
    metodo_pagamento: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(Expense)
    if da:
        q = q.where(Expense.data >= da)
    if a:
        q = q.where(Expense.data <= a)
    if tipo_spesa:
        q = q.where(Expense.tipo_spesa == tipo_spesa)
    if metodo_pagamento:
        q = q.where(Expense.metodo_pagamento == metodo_pagamento)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (
        await db.execute(
            q.order_by(Expense.data.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars().all()
    return PaginatedResponse(total=total, items=rows, page=page, page_size=page_size)


@router.post("", response_model=ExpenseRead, status_code=status.HTTP_201_CREATED)
async def create_expense(payload: ExpenseCreate, db: AsyncSession = Depends(get_db)):
    exp = Expense(**payload.model_dump())
    db.add(exp)
    await db.flush()
    await db.refresh(exp)
    return exp


@router.patch("/{id}", response_model=ExpenseRead)
async def update_expense(id: int, payload: ExpenseUpdate, db: AsyncSession = Depends(get_db)):
    exp = await db.get(Expense, id)
    if not exp:
        raise HTTPException(status_code=404, detail="Spesa non trovata")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(exp, k, v)
    await db.flush()
    await db.refresh(exp)
    return exp


@router.delete("/{id}", response_model=MessageResponse)
async def delete_expense(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exp = await db.get(Expense, id)
    if not exp:
        raise HTTPException(status_code=404, detail="Spesa non trovata")
    log = DeletionLog(
        utente_eliminazione=current_user.username,
        tipo_operazione="Spesa",
        data_operazione=exp.data.isoformat(),
        utente_operazione=exp.utente,
        nota=exp.nota,
        importo=exp.importo,
        tipo_spesa=exp.tipo_spesa,
        fornitore=exp.fornitore,
    )
    db.add(log)
    await db.delete(exp)
    return MessageResponse(message=f"Spesa {id} eliminata")


@router.get("/totale", response_model=dict)
async def get_totale(
    da: datetime | None = None,
    a: datetime | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(func.coalesce(func.sum(Expense.importo), 0))
    if da:
        q = q.where(Expense.data >= da)
    if a:
        q = q.where(Expense.data <= a)
    totale = (await db.execute(q)).scalar_one()
    return {"totale": Decimal(str(totale))}
