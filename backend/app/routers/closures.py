from __future__ import annotations

import calendar
import json
import logging
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status

logger = logging.getLogger(__name__)
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.daily_closure import DailyClosure
from app.models.receipt_payment import ReceiptPayment
from app.models.shop_receipt import ShopReceipt
from app.models.shop_settings import ShopSettings
from app.schemas.daily_closure import ClosureCreate, ClosurePreview, ClosureRead
from app.services.entratel import ShopInfo, generate as entratel_generate

router = APIRouter(
    prefix="/api/v1/closures",
    tags=["closures"],
    dependencies=[Depends(get_current_user)],
)


async def _compute_day_corrispettivi(db: AsyncSession, day: datetime) -> dict:
    """Calcola totali e canali dalle ricevute del giorno."""
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)

    # Ricevute del giorno
    receipts = (await db.execute(
        select(ShopReceipt)
        .where(ShopReceipt.receipt_ts >= start, ShopReceipt.receipt_ts < end)
        .options(selectinload(ShopReceipt.payments))
    )).scalars().all()

    totale = sum(r.total_paid for r in receipts)
    n = len(receipts)

    # Somma per canale (da receipt_payments)
    canali: dict[str, float] = {}
    for r in receipts:
        if r.payments:
            for p in r.payments:
                m = p.metodo
                canali[m] = canali.get(m, 0.0) + float(p.importo)
        elif r.metodo_pagamento:
            # fallback per ricevute senza split
            m = r.metodo_pagamento
            canali[m] = canali.get(m, 0.0) + float(r.total_paid)

    return {
        "totale_corrispettivi": float(totale),
        "n_ricevute": n,
        "canali": canali,
    }


@router.get("/preview", response_model=ClosurePreview)
async def preview_corrispettivi(
    data: datetime = Query(..., description="Giorno da calcolare (ISO datetime)"),
    db: AsyncSession = Depends(get_db),
):
    """Restituisce un'anteprima dei corrispettivi del giorno dalle ricevute, senza creare la chiusura."""
    computed = await _compute_day_corrispettivi(db, data)
    from decimal import Decimal
    return ClosurePreview(
        data=data,
        totale_corrispettivi=Decimal(str(computed["totale_corrispettivi"])),
        n_ricevute=computed["n_ricevute"],
        canali={k: Decimal(str(v)) for k, v in computed["canali"].items()},
    )


@router.get("", response_model=list[ClosureRead])
async def list_closures(
    da: datetime | None = None,
    a: datetime | None = None,
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(DailyClosure)
    if da:
        q = q.where(DailyClosure.closure_ts >= da)
    if a:
        q = q.where(DailyClosure.closure_ts <= a)
    rows = (
        await db.execute(q.order_by(DailyClosure.closure_ts.desc()).limit(limit))
    ).scalars().all()
    return rows


@router.get("/export/entratel")
async def export_entratel(
    anno: int = Query(..., ge=2020, le=2099, description="Anno d'imposta"),
    mese: int = Query(..., ge=1, le=12, description="Mese (1-12)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Genera il file corrispettivi in formato Entratel AdE (Prov. 12/03/2009).
    Restituisce un file .txt a larghezza fissa (1800 char/record, encoding latin-1).
    """
    settings = (await db.execute(select(ShopSettings).limit(1))).scalar_one_or_none()
    if not settings or not settings.codice_fiscale:
        raise HTTPException(
            status_code=422,
            detail="Configura prima i dati del negozio (Impostazioni → Dati Fiscali).",
        )

    # Costruisci dizionario giornaliero dalle closures del mese
    primo = datetime(anno, mese, 1, 0, 0, 0)
    ultimo_giorno = calendar.monthrange(anno, mese)[1]
    ultimo = datetime(anno, mese, ultimo_giorno, 23, 59, 59)

    closures = (await db.execute(
        select(DailyClosure)
        .where(DailyClosure.closure_ts >= primo, DailyClosure.closure_ts <= ultimo)
        .order_by(DailyClosure.closure_ts)
    )).scalars().all()

    daily: dict[date, dict[str, float]] = {}
    for c in closures:
        d = c.closure_ts.date()
        if c.iva_json:
            try:
                iva_list: list[dict] = json.loads(c.iva_json)
                day_acc = daily.setdefault(d, {})
                for entry in iva_list:
                    code = entry.get("aliquota", "RP")
                    lordo = float(entry.get("lordo", 0))
                    day_acc[code] = day_acc.get(code, 0.0) + lordo
            except Exception as exc:
                logger.warning("closure %s: iva_json malformato, giorno omesso — %s", c.id, exc)
        elif c.totale_corrispettivi is not None:
            # Nessun dettaglio IVA → tutto RP (regime del margine)
            aliquota = "RP" if settings.regime_fiscale == "margine" else "22"
            day_acc = daily.setdefault(d, {})
            day_acc[aliquota] = day_acc.get(aliquota, 0.0) + float(c.totale_corrispettivi)

    shop = ShopInfo(
        ragione_sociale=settings.ragione_sociale,
        codice_fiscale=settings.codice_fiscale,
        numero_rea=settings.numero_rea or "",
        indirizzo=settings.indirizzo,
        comune=settings.citta,
        provincia=settings.provincia,
    )

    content = entratel_generate(shop, anno, mese, daily)
    filename = f"corrispettivi_{anno}_{mese:02d}.txt"
    return Response(
        content=content,
        media_type="text/plain; charset=latin-1",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", response_model=ClosureRead, status_code=status.HTTP_201_CREATED)
async def create_closure(payload: ClosureCreate, db: AsyncSession = Depends(get_db)):
    diff = payload.effettivo_cassa - payload.saldo_contabile
    data = payload.model_dump()

    # Se corrispettivi non forniti, calcolali automaticamente dalle ricevute
    if data.get("totale_corrispettivi") is None:
        computed = await _compute_day_corrispettivi(db, payload.closure_ts)
        data["totale_corrispettivi"] = computed["totale_corrispettivi"]
        data["n_ricevute"] = computed["n_ricevute"]
        if not data.get("canali_json"):
            data["canali_json"] = json.dumps(computed["canali"], ensure_ascii=False)

    cl = DailyClosure(**data, differenza=diff)
    db.add(cl)
    await db.flush()
    await db.refresh(cl)
    return cl
