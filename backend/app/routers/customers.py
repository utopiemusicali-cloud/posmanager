from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.customer import Customer
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.customer import CustomerCreate, CustomerRead, CustomerUpdate

router = APIRouter(
    prefix="/api/v1/customers",
    tags=["customers"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=PaginatedResponse[CustomerRead])
async def list_customers(
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Customer)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Customer.nome.ilike(like),
                Customer.tel.ilike(like),
                Customer.mail.ilike(like),
                Customer.instagram.ilike(like),
            )
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(
            stmt.order_by(Customer.nome).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars().all()
    return PaginatedResponse(total=total, items=rows, page=page, page_size=page_size)


@router.post("", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
async def create_customer(payload: CustomerCreate, db: AsyncSession = Depends(get_db)):
    customer = Customer(**payload.model_dump())
    db.add(customer)
    await db.flush()
    await db.refresh(customer)
    return customer


@router.get("/{id}", response_model=CustomerRead)
async def get_customer(id: int, db: AsyncSession = Depends(get_db)):
    c = await db.get(Customer, id)
    if not c:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    return c


@router.patch("/{id}", response_model=CustomerRead)
async def update_customer(id: int, payload: CustomerUpdate, db: AsyncSession = Depends(get_db)):
    c = await db.get(Customer, id)
    if not c:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    await db.flush()
    await db.refresh(c)
    return c


@router.delete("/{id}", response_model=MessageResponse)
async def delete_customer(id: int, db: AsyncSession = Depends(get_db)):
    c = await db.get(Customer, id)
    if not c:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    await db.delete(c)
    return MessageResponse(message=f"Cliente {id} eliminato")
