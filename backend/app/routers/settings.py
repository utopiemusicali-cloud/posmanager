from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.shop_settings import ShopSettings
from app.schemas.shop_settings import ShopSettingsRead, ShopSettingsUpdate

router = APIRouter(
    prefix="/api/v1/settings",
    tags=["settings"],
    dependencies=[Depends(get_current_user)],
)


async def _get_or_create(db: AsyncSession) -> ShopSettings:
    row = (await db.execute(select(ShopSettings).limit(1))).scalar_one_or_none()
    if not row:
        row = ShopSettings()
        db.add(row)
        await db.flush()
        await db.refresh(row)
    return row


@router.get("", response_model=ShopSettingsRead)
async def get_settings(db: AsyncSession = Depends(get_db)):
    return await _get_or_create(db)


@router.put("", response_model=ShopSettingsRead)
async def update_settings(
    payload: ShopSettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    row = await _get_or_create(db)
    for k, v in payload.model_dump().items():
        setattr(row, k, v)
    await db.flush()
    await db.refresh(row)
    return row
