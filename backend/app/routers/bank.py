"""Movimenti del conto business, importati dall'estratto conto SumUp.

SumUp non espone il conto nella sua API pubblica: l'unico modo di avere
bonifici, spese con carta e saldo e' importare il file scaricato dal
dashboard. Il "Saldo disponibile" presente nell'estratto conto e' un saldo
reale, non una stima ricavata per differenza.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user, require_not_viewer
from app.database import get_db
from app.models.bank_movement import BankMovement
from app.services import bank_import_service

router = APIRouter(
    prefix="/api/v1/bank",
    tags=["bank"],
    dependencies=[Depends(get_current_user)],
)

# Oltre questa soglia il file non e' un estratto conto ma un errore
# dell'utente: meglio rifiutarlo subito che riempire la memoria del server.
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@router.post("/import")
async def import_statement(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_not_viewer),
):
    """Importa un estratto conto. Idempotente sul codice transazione:
    reimportare lo stesso file, o file che si sovrappongono, aggiorna i
    movimenti invece di duplicarli."""
    content = await file.read()
    if not content:
        raise HTTPException(400, "Il file e' vuoto.")
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File troppo grande (limite 10 MB).")

    try:
        movimenti, avvisi = bank_import_service.parse_statement(content)
    except bank_import_service.BankImportError as e:
        raise HTTPException(400, str(e))

    codici = [m["codice_transazione"] for m in movimenti]
    gia_presenti = set()
    if codici:
        gia_presenti = {
            r[0] for r in (await db.execute(
                select(BankMovement.codice_transazione)
                .where(BankMovement.codice_transazione.in_(codici))
            )).all()
        }

    for m in movimenti:
        stmt = (
            mysql_insert(BankMovement)
            .values(**m)
            .on_duplicate_key_update(
                # 'categoria' non compare qui perche' il parser non la produce:
                # e' assegnata a mano dall'utente, e cosi' un reimport dello
                # stesso periodo non gliela cancella.
                **{k: v for k, v in m.items() if k != "codice_transazione"}
            )
        )
        await db.execute(stmt)
    await db.commit()

    nuovi = len(movimenti) - len(gia_presenti)
    return {
        "letti": len(movimenti),
        "nuovi": nuovi,
        "aggiornati": len(gia_presenti),
        "avvisi": avvisi,
        "file": file.filename,
    }


@router.get("/movements")
async def list_movements(
    days: int | None = Query(None, ge=1, le=3650),
    tipo: str | None = None,
    categoria: str | None = None,
    solo: str | None = Query(None, pattern="^(entrate|uscite)$"),
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    if days:
        conditions.append(BankMovement.data >= datetime.now() - timedelta(days=days))
    if tipo:
        conditions.append(BankMovement.tipo == tipo)
    if categoria:
        conditions.append(BankMovement.categoria == categoria)
    if solo == "entrate":
        conditions.append(BankMovement.importo > 0)
    elif solo == "uscite":
        conditions.append(BankMovement.importo < 0)
    if q:
        like = "%" + q.strip() + "%"
        conditions.append(
            BankMovement.causale.like(like) | BankMovement.riferimento.like(like)
        )

    base = select(BankMovement)
    count_stmt = select(func.count()).select_from(BankMovement)
    if conditions:
        base = base.where(*conditions)
        count_stmt = count_stmt.where(*conditions)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(
        base.order_by(BankMovement.data.desc(), BankMovement.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [_to_dict(m) for m in rows],
    }


@router.get("/summary")
async def summary(
    days: int = Query(90, ge=1, le=3650),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now() - timedelta(days=days)

    entrate, uscite, n = (await db.execute(
        select(
            func.coalesce(func.sum(case((BankMovement.importo > 0, BankMovement.importo), else_=0)), 0),
            func.coalesce(func.sum(case((BankMovement.importo < 0, BankMovement.importo), else_=0)), 0),
            func.count(),
        ).where(BankMovement.data >= since)
    )).one()

    # Il saldo e' quello del movimento piu' recente in assoluto, non del
    # periodo filtrato: un saldo "degli ultimi 30 giorni" non significa nulla.
    ultimo = (await db.execute(
        select(BankMovement)
        .where(BankMovement.saldo_disponibile.isnot(None))
        .order_by(BankMovement.data.desc(), BankMovement.id.desc())
        .limit(1)
    )).scalars().first()

    per_categoria = [
        {"categoria": r[0] or "Non assegnata", "totale": float(r[1] or 0), "n": r[2]}
        for r in (await db.execute(
            select(BankMovement.categoria, func.sum(BankMovement.importo), func.count())
            .where(BankMovement.data >= since, BankMovement.importo < 0)
            .group_by(BankMovement.categoria)
            .order_by(func.sum(BankMovement.importo))
        )).all()
    ]

    return {
        "giorni": days,
        "entrate": float(entrate or 0),
        "uscite": float(uscite or 0),
        "saldo_netto_periodo": float((entrate or 0) + (uscite or 0)),
        "n_movimenti": n,
        "saldo_disponibile": float(ultimo.saldo_disponibile) if ultimo else None,
        "saldo_aggiornato_al": ultimo.data.isoformat() if ultimo else None,
        "uscite_per_categoria": per_categoria,
    }


class UpdateMovement(BaseModel):
    categoria: str | None = None


@router.patch("/movements/{movement_id}")
async def update_movement(
    movement_id: int,
    body: UpdateMovement,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_not_viewer),
):
    row = await db.get(BankMovement, movement_id)
    if not row:
        raise HTTPException(404, "Movimento non trovato")
    if body.categoria is not None:
        row.categoria = body.categoria or None
    await db.commit()
    return {"ok": True}


@router.get("/types")
async def movement_types(db: AsyncSession = Depends(get_db)):
    """Tipi presenti nei dati, per popolare il filtro senza inventarli."""
    rows = (await db.execute(
        select(BankMovement.tipo, func.count())
        .where(BankMovement.tipo.isnot(None))
        .group_by(BankMovement.tipo).order_by(func.count().desc())
    )).all()
    return {"tipi": [{"value": r[0], "count": r[1]} for r in rows]}


def _to_dict(m: BankMovement) -> dict:
    return {
        "id": m.id,
        "codice_transazione": m.codice_transazione,
        "data": m.data.isoformat() if m.data else None,
        "tipo": m.tipo,
        "riferimento": m.riferimento,
        "causale": m.causale,
        "stato": m.stato,
        "importo": float(m.importo or 0),
        "valuta": m.valuta,
        "importo_valuta_originale": float(m.importo_valuta_originale) if m.importo_valuta_originale is not None else None,
        "valuta_originale": m.valuta_originale,
        "tasso_cambio": float(m.tasso_cambio) if m.tasso_cambio is not None else None,
        "commissione": float(m.commissione) if m.commissione is not None else None,
        "saldo_disponibile": float(m.saldo_disponibile) if m.saldo_disponibile is not None else None,
        "categoria": m.categoria,
    }
