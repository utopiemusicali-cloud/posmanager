from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, require_admin
from app.database import get_db
from app.models.company_settings import CompanySettings
from app.models.shop_settings import ShopSettings
from app.schemas.shop_settings import ShopSettingsRead, ShopSettingsUpdate

router = APIRouter(
    prefix="/api/v1/settings",
    tags=["settings"],
    dependencies=[Depends(get_current_user)],
)


# ── Shop settings (dati negozio / fiscali) ────────────────────────────────────

async def _get_or_create_shop(db: AsyncSession) -> ShopSettings:
    row = (await db.execute(select(ShopSettings).limit(1))).scalar_one_or_none()
    if not row:
        row = ShopSettings()
        db.add(row)
        await db.flush()
        await db.refresh(row)
    return row


@router.get("", response_model=ShopSettingsRead)
async def get_settings(db: AsyncSession = Depends(get_db)):
    return await _get_or_create_shop(db)


@router.put("", response_model=ShopSettingsRead)
async def update_settings(
    payload: ShopSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
):
    row = await _get_or_create_shop(db)
    for k, v in payload.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await db.refresh(row)
    return row


# ── Integrazioni (Discogs, SumUp, PayPal) — solo admin ────────────────────────

class IntegrationsRead(BaseModel):
    discogs_token: str | None
    discogs_username: str | None
    sumup_api_key: str | None
    sumup_merchant_code: str | None
    paypal_client_id: str | None
    currency: str

    model_config = {"from_attributes": True}


class IntegrationsUpdate(BaseModel):
    discogs_token: str | None = None
    discogs_username: str | None = None
    sumup_api_key: str | None = None
    sumup_merchant_code: str | None = None
    paypal_client_id: str | None = None
    currency: str | None = None


async def _get_or_create_integrations(db: AsyncSession) -> CompanySettings:
    row = (await db.execute(select(CompanySettings).limit(1))).scalar_one_or_none()
    if not row:
        row = CompanySettings()
        db.add(row)
        await db.flush()
        await db.refresh(row)
    return row


@router.get("/integrations", response_model=IntegrationsRead)
async def get_integrations(
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
):
    return await _get_or_create_integrations(db)


@router.put("/integrations", response_model=IntegrationsRead)
async def update_integrations(
    payload: IntegrationsUpdate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
):
    row = await _get_or_create_integrations(db)
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(row, k, v)
    await db.flush()
    await db.refresh(row)
    return row
