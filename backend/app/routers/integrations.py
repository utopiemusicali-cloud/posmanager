from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, require_not_viewer
from app.config import settings
from app.database import get_db
from app.models.company_settings import CompanySettings
from app.models.digital_transaction import DigitalTransaction
from app.services import paypal_service, sumup_service
from app.services.discogs_orders_service import (
    ORDER_STATUSES, cancel_order, fetch_all_orders, fetch_orders,
    get_order_messages, mark_as_shipped,
)

router = APIRouter(
    prefix="/api/v1/integrations",
    tags=["integrations"],
    dependencies=[Depends(get_current_user)],
)


async def _require_token(db: AsyncSession = Depends(get_db)) -> str:
    """Token Discogs dell'azienda corrente (company_settings_integrations).
    Fallback su DISCOGS_TOKEN globale solo per retrocompatibilità (azienda di default)."""
    cs = (await db.execute(select(CompanySettings))).scalars().first()
    token = (cs.discogs_token if cs else None) or settings.DISCOGS_TOKEN
    if not token:
        raise HTTPException(400, "Discogs token non configurato. Vai su Impostazioni > Integrazioni.")
    return token


# ── Ordini paginati (default) ──────────────────────────────────────────────────

@router.get("/discogs/orders")
async def get_discogs_orders(
    status: str = Query("All"),
    sort_order: str = Query("desc"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    token: str = Depends(_require_token),
):
    try:
        return await fetch_orders(token, status, sort_order, page, per_page)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")


# ── Tutti gli ordini per anno (con statistiche) ───────────────────────────────

@router.get("/discogs/orders/year/{year}")
async def get_discogs_orders_year(year: int, token: str = Depends(_require_token)):
    try:
        orders = await fetch_all_orders(token, year)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")

    # Raggruppa per mese
    by_month: dict[str, list] = {}
    for o in orders:
        created = o.get("created", "")
        if created:
            month_key = created[:7]  # "2026-01"
            by_month.setdefault(month_key, []).append(o)

    return {"orders": orders, "by_month": by_month, "total": len(orders)}


# ── Messaggi ordine ────────────────────────────────────────────────────────────

@router.get("/discogs/orders/{order_id}/messages")
async def get_messages(order_id: str, token: str = Depends(_require_token)):
    try:
        msgs = await get_order_messages(token, order_id)
        return {"messages": msgs}
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")


class SendMessagePayload(BaseModel):
    message: str


@router.post("/discogs/orders/{order_id}/messages")
async def send_message(order_id: str, body: SendMessagePayload, token: str = Depends(_require_token)):
    """Invia un messaggio all'acquirente senza cambiare lo status dell'ordine."""
    if not body.message.strip():
        raise HTTPException(400, "Messaggio vuoto")
    headers = {
        "Authorization": f"Discogs token={token}",
        "Content-Type": "application/json",
        "User-Agent": "posmanager/1.0",
    }
    import httpx
    async with httpx.AsyncClient(headers=headers, timeout=20) as client:
        resp = await client.post(
            f"https://api.discogs.com/marketplace/orders/{order_id}/messages",
            json={"message": body.message},
        )
    if resp.status_code == 201:
        return {"ok": True}
    raise HTTPException(502, f"Discogs ha risposto con {resp.status_code}")


# ── Segna come spedito ─────────────────────────────────────────────────────────

class ShipPayload(BaseModel):
    tracking: str
    buyer: str = ""
    shipping_method: str = ""


@router.post("/discogs/orders/{order_id}/ship")
async def ship_order(order_id: str, body: ShipPayload, token: str = Depends(_require_token)):
    if not body.tracking.strip():
        raise HTTPException(400, "Numero di tracking obbligatorio")
    try:
        ok = await mark_as_shipped(token, order_id, body.tracking, body.buyer, body.shipping_method)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")
    if not ok:
        raise HTTPException(500, "Discogs ha rifiutato la richiesta")
    return {"ok": True}


# ── Cancella ordine ────────────────────────────────────────────────────────────

class CancelPayload(BaseModel):
    reason: str


@router.post("/discogs/orders/{order_id}/cancel")
async def cancel_discogs_order(order_id: str, body: CancelPayload, token: str = Depends(_require_token)):
    try:
        ok = await cancel_order(token, order_id, body.reason)
    except Exception as e:
        raise HTTPException(502, f"Errore Discogs API: {e}")
    if not ok:
        raise HTTPException(500, "Discogs ha rifiutato la richiesta")
    return {"ok": True}


# ── Immagini di un release ────────────────────────────────────────────────────

@router.get("/discogs/releases/{release_id}/images")
async def get_release_images(release_id: int, token: str = Depends(_require_token)):
    import httpx
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": "posmanager/1.0"}
    async with httpx.AsyncClient(headers=headers, timeout=15) as c:
        resp = await c.get(f"https://api.discogs.com/releases/{release_id}")
        resp.raise_for_status()
        data = resp.json()
    images = [
        {"uri": img["uri"], "thumb": img.get("uri150", img["uri"])}
        for img in data.get("images", [])
        if img.get("uri")
    ]
    return {"images": images, "title": data.get("title", ""), "year": data.get("year", "")}


# ── Statuses disponibili ───────────────────────────────────────────────────────

@router.get("/discogs/order-statuses")
async def get_order_statuses():
    return {"statuses": ORDER_STATUSES}


# ── Stub SumUp / PayPal ───────────────────────────────────────────────────────

# ── SumUp: importazione transazioni (sola lettura) ────────────────────────────

async def _sumup_credentials(db: AsyncSession) -> tuple[str, str | None]:
    cs = (await db.execute(select(CompanySettings))).scalars().first()
    api_key = cs.sumup_api_key if cs else None
    if not api_key:
        raise HTTPException(
            400,
            "Chiave API SumUp non configurata. Vai su Impostazioni > Integrazioni "
            "e inserisci la secret key (sup_sk_...).",
        )
    return api_key, (cs.sumup_merchant_code or None)


@router.post("/sumup/test")
async def test_sumup(db: AsyncSession = Depends(get_db), _=Depends(require_not_viewer)):
    """Verifica la chiave API e mostra a quale conto e' collegata."""
    api_key, _merchant = await _sumup_credentials(db)
    try:
        profile = await sumup_service.get_profile(api_key)
    except sumup_service.SumUpError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Errore di rete verso SumUp: {e}")

    account = profile.get("merchant_profile") or {}
    return {
        "ok": True,
        "merchant_code": account.get("merchant_code"),
        "nome": account.get("company_name") or profile.get("account", {}).get("username"),
    }


@router.post("/sumup/sync")
async def sync_sumup(
    days: int = Query(90, ge=1, le=1095),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_not_viewer),
):
    """Importa le transazioni SumUp degli ultimi `days` giorni in
    digital_transactions. Idempotente: il vincolo di unicita' su
    (fonte, transaction_id) fa sì che rilanciarlo aggiorni invece di duplicare."""
    api_key, merchant_code = await _sumup_credentials(db)

    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    try:
        transactions = await sumup_service.fetch_transactions(
            api_key, merchant_code, start, end
        )
    except sumup_service.SumUpError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Errore durante la lettura da SumUp: {e}")

    for tx in transactions:
        stmt = (
            mysql_insert(DigitalTransaction)
            .values(**tx)
            .on_duplicate_key_update(
                **{k: v for k, v in tx.items() if k not in ("fonte", "transaction_id")}
            )
        )
        await db.execute(stmt)
    await db.commit()

    return {
        "imported": len(transactions),
        "dal": start.isoformat(),
        "al": end.isoformat(),
    }


# ── PayPal: importazione transazioni (sola lettura) ───────────────────────────

async def _paypal_credentials(db: AsyncSession) -> tuple[str, str, bool]:
    cs = (await db.execute(select(CompanySettings))).scalars().first()
    client_id = cs.paypal_client_id if cs else None
    secret = cs.paypal_client_secret if cs else None
    if not client_id or not secret:
        raise HTTPException(
            400,
            "Credenziali PayPal non configurate. Vai su Impostazioni > Integrazioni "
            "e inserisci Client ID e Secret.",
        )
    return client_id, secret, bool(cs.paypal_sandbox)


@router.post("/paypal/test")
async def test_paypal(db: AsyncSession = Depends(get_db), _=Depends(require_not_viewer)):
    """Verifica che le credenziali siano valide, senza importare nulla."""
    client_id, secret, sandbox = await _paypal_credentials(db)
    try:
        await paypal_service.get_access_token(client_id, secret, sandbox)
    except paypal_service.PayPalError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Errore di rete verso PayPal: {e}")
    return {"ok": True, "ambiente": "sandbox" if sandbox else "produzione"}


@router.post("/paypal/sync")
async def sync_paypal(
    days: int = Query(30, ge=1, le=1095),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_not_viewer),
):
    """Importa le transazioni PayPal degli ultimi `days` giorni in
    digital_transactions. Idempotente: il vincolo di unicita' su
    (fonte, transaction_id) fa sì che rilanciarlo aggiorni invece di duplicare.
    PayPal conserva lo storico per circa 3 anni, da cui il limite su days."""
    client_id, secret, sandbox = await _paypal_credentials(db)

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    try:
        transactions = await paypal_service.fetch_transactions(
            client_id, secret, sandbox, start, end
        )
    except paypal_service.PayPalError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Errore durante la lettura da PayPal: {e}")

    for tx in transactions:
        stmt = (
            mysql_insert(DigitalTransaction)
            .values(**tx)
            .on_duplicate_key_update(
                **{k: v for k, v in tx.items() if k not in ("fonte", "transaction_id")}
            )
        )
        await db.execute(stmt)
    await db.commit()

    return {
        "imported": len(transactions),
        "ambiente": "sandbox" if sandbox else "produzione",
        "dal": start.date().isoformat(),
        "al": end.date().isoformat(),
    }
