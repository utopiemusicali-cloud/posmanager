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
    # La chiave SumUp e' un segreto: come per PayPal non viene mai
    # restituita, si comunica solo se e' stata configurata.
    sumup_key_set: bool = False
    sumup_merchant_code: str | None
    paypal_client_id: str | None
    paypal_sandbox: bool = True
    # Il secret non viene mai restituito: l'interfaccia deve solo sapere se
    # e' stato configurato, per non riesporlo a ogni apertura della pagina.
    paypal_secret_set: bool = False
    currency: str

    model_config = {"from_attributes": True}


class IntegrationsUpdate(BaseModel):
    discogs_token: str | None = None
    discogs_username: str | None = None
    sumup_api_key: str | None = None
    sumup_merchant_code: str | None = None
    paypal_client_id: str | None = None
    paypal_client_secret: str | None = None
    paypal_sandbox: bool | None = None
    currency: str | None = None


def _to_read(row: CompanySettings) -> IntegrationsRead:
    return IntegrationsRead(
        discogs_token=row.discogs_token,
        discogs_username=row.discogs_username,
        sumup_key_set=bool(row.sumup_api_key),
        sumup_merchant_code=row.sumup_merchant_code,
        paypal_client_id=row.paypal_client_id,
        paypal_sandbox=bool(row.paypal_sandbox),
        paypal_secret_set=bool(row.paypal_client_secret),
        currency=row.currency,
    )


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
    return _to_read(await _get_or_create_integrations(db))


@router.put("/integrations", response_model=IntegrationsRead)
async def update_integrations(
    payload: IntegrationsUpdate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
):
    row = await _get_or_create_integrations(db)
    # exclude_unset (non exclude_none): con exclude_none un flag booleano
    # messo a False verrebbe scartato, rendendo impossibile disattivarlo.
    data = payload.model_dump(exclude_unset=True)

    # Cambio di ambiente PayPal senza un nuovo secret: quello memorizzato
    # appartiene all'altro ambiente e non vi autentichera' mai. Tenerlo
    # accoppiato a un client_id del nuovo ambiente produce un 401 opaco,
    # quindi lo si azzera per costringere a reinserirlo.
    if data.get("paypal_sandbox") is not None and not data.get("paypal_client_secret"):
        if bool(data["paypal_sandbox"]) != bool(row.paypal_sandbox):
            row.paypal_client_secret = None

    for k, v in data.items():
        if v is None:
            continue
        setattr(row, k, v)
    await db.flush()
    await db.refresh(row)
    return _to_read(row)
