from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_superadmin
from app.auth.service import create_access_token
from app.database import get_main_db
from app.models.company import Company
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class CompanyOut(BaseModel):
    id: int
    name: str
    db_name: str
    is_active: bool
    user_count: int = 0

    model_config = {"from_attributes": True}


class ViewTokenOut(BaseModel):
    access_token: str
    company_name: str
    company_id: int


@router.get("/companies", response_model=list[CompanyOut])
async def list_companies(
    _sa: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_main_db),
):
    companies = (await db.execute(select(Company).order_by(Company.id))).scalars().all()
    # Conta utenti per azienda
    counts_rows = (await db.execute(
        select(User.company_id, func.count(User.id))
        .where(User.company_id.isnot(None))
        .group_by(User.company_id)
    )).all()
    counts = {cid: cnt for cid, cnt in counts_rows}
    return [
        CompanyOut(id=c.id, name=c.name, db_name=c.db_name,
                   is_active=c.is_active, user_count=counts.get(c.id, 0))
        for c in companies
    ]


@router.post("/companies/{company_id}/view-token", response_model=ViewTokenOut)
async def get_view_token(
    company_id: int,
    _sa: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_main_db),
):
    company = (await db.execute(
        select(Company).where(Company.id == company_id)
    )).scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")

    viewer = (await db.execute(
        select(User).where(User.company_id == company_id, User.role == UserRole.viewer)
    )).scalar_one_or_none()
    if not viewer:
        raise HTTPException(status_code=404, detail="Nessun utente viewer per questa azienda")

    token = create_access_token({
        "sub": viewer.username,
        "uid": viewer.id,
        "cid": viewer.company_id,
        "cdb": company.db_name,
        "role": viewer.role,
    })
    return ViewTokenOut(access_token=token, company_name=company.name, company_id=company.id)
