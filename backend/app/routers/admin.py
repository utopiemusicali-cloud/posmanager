from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_superadmin
from app.auth.service import create_access_token
from app.database import get_company_session_maker, get_main_db
from app.models.company import Company
from app.models.company_settings import CompanySettings
from app.models.user import User, UserRole
from app.services.tenant_service import create_tenant, slugify_db_name

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

_DB_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")


# ── Schemi ────────────────────────────────────────────────────────────────────

class CompanyOut(BaseModel):
    id: int
    name: str
    db_name: str
    is_active: bool
    user_count: int = 0

    model_config = {"from_attributes": True}


class CreateCompanyIn(BaseModel):
    name: str
    db_name: str
    admin_username: str
    admin_password: str
    email: str | None = None
    discogs_token: str | None = None
    discogs_username: str | None = None


class UpdateCompanyIn(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class CompanySettingsOut(BaseModel):
    discogs_token: str | None = None
    discogs_username: str | None = None
    discogs_password: str | None = None
    sumup_api_key: str | None = None
    sumup_merchant_code: str | None = None
    paypal_client_id: str | None = None
    paypal_client_secret: str | None = None


class UpdateCompanySettingsIn(BaseModel):
    discogs_token: str | None = None
    discogs_username: str | None = None
    discogs_password: str | None = None
    sumup_api_key: str | None = None
    sumup_merchant_code: str | None = None
    paypal_client_id: str | None = None
    paypal_client_secret: str | None = None


class ViewTokenOut(BaseModel):
    access_token: str
    company_name: str
    company_id: int


class SlugSuggestionOut(BaseModel):
    db_name: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_company_or_404(db: AsyncSession, company_id: int) -> Company:
    company = (await db.execute(
        select(Company).where(Company.id == company_id)
    )).scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")
    return company


def _cs_to_out(cs: CompanySettings | None) -> CompanySettingsOut:
    if not cs:
        return CompanySettingsOut()
    return CompanySettingsOut(
        discogs_token=cs.discogs_token,
        discogs_username=cs.discogs_username,
        discogs_password=cs.discogs_password,
        sumup_api_key=cs.sumup_api_key,
        sumup_merchant_code=cs.sumup_merchant_code,
        paypal_client_id=cs.paypal_client_id,
        paypal_client_secret=cs.paypal_client_secret,
    )


# ── Aziende ───────────────────────────────────────────────────────────────────

@router.get("/companies", response_model=list[CompanyOut])
async def list_companies(
    _sa: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_main_db),
):
    companies = (await db.execute(select(Company).order_by(Company.id))).scalars().all()
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


@router.get("/companies/slug-suggestion", response_model=SlugSuggestionOut)
async def suggest_slug(
    name: str,
    _sa: User = Depends(require_superadmin),
):
    """Suggerisce un db_name sicuro a partire dal nome azienda."""
    return SlugSuggestionOut(db_name=slugify_db_name(name))


@router.post("/companies", response_model=CompanyOut)
async def create_company(
    body: CreateCompanyIn,
    _sa: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_main_db),
):
    if not _DB_NAME_RE.match(body.db_name):
        raise HTTPException(400, "db_name non valido (solo minuscole, cifre, underscore; min 3 chars)")

    if (await db.execute(select(Company).where(Company.db_name == body.db_name))).scalar_one_or_none():
        raise HTTPException(400, "db_name già in uso")

    if (await db.execute(select(User).where(User.username == body.admin_username))).scalar_one_or_none():
        raise HTTPException(400, "Username admin già in uso")

    company = await create_tenant(
        db,
        name=body.name,
        db_name=body.db_name,
        admin_username=body.admin_username,
        admin_password=body.admin_password,
        email=body.email,
        discogs_token=body.discogs_token,
        discogs_username=body.discogs_username,
    )
    return CompanyOut(
        id=company.id, name=company.name, db_name=company.db_name,
        is_active=company.is_active, user_count=2,
    )


@router.put("/companies/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: int,
    body: UpdateCompanyIn,
    _sa: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_main_db),
):
    company = await _get_company_or_404(db, company_id)

    if body.name is not None:
        company.name = body.name
    if body.is_active is not None:
        company.is_active = body.is_active

    await db.flush()

    user_count = (await db.execute(
        select(func.count(User.id)).where(User.company_id == company_id)
    )).scalar() or 0

    return CompanyOut(
        id=company.id, name=company.name, db_name=company.db_name,
        is_active=company.is_active, user_count=user_count,
    )


# ── Impostazioni per tenant ───────────────────────────────────────────────────

@router.get("/companies/{company_id}/settings", response_model=CompanySettingsOut)
async def get_company_settings(
    company_id: int,
    _sa: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_main_db),
):
    company = await _get_company_or_404(db, company_id)
    maker = get_company_session_maker(company.db_name)
    async with maker() as cdb:
        cs = (await cdb.execute(select(CompanySettings))).scalars().first()
    return _cs_to_out(cs)


@router.put("/companies/{company_id}/settings", response_model=CompanySettingsOut)
async def update_company_settings(
    company_id: int,
    body: UpdateCompanySettingsIn,
    _sa: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_main_db),
):
    company = await _get_company_or_404(db, company_id)
    maker = get_company_session_maker(company.db_name)
    async with maker() as cdb:
        cs = (await cdb.execute(select(CompanySettings))).scalars().first()
        if not cs:
            cs = CompanySettings()
            cdb.add(cs)
            await cdb.flush()

        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(cs, field, value or None)

        await cdb.commit()
        result = _cs_to_out(cs)

    return result


# ── View-token ────────────────────────────────────────────────────────────────

@router.post("/companies/{company_id}/view-token", response_model=ViewTokenOut)
async def get_view_token(
    company_id: int,
    _sa: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_main_db),
):
    company = await _get_company_or_404(db, company_id)

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
