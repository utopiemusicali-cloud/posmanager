from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.cash_session import CashSession
from app.models.user import User
from app.schemas.cash_session import SessionClose, SessionOpen, SessionRead
from app.schemas.common import MessageResponse

router = APIRouter(
    prefix="/api/v1/sessions",
    tags=["sessions"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=list[SessionRead])
async def list_sessions(
    limit: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(CashSession)
            .order_by(CashSession.data_apertura.desc())
            .limit(limit)
        )
    ).scalars().all()
    return rows


@router.get("/active", response_model=SessionRead | None)
async def get_active_session(db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(
            select(CashSession)
            .where(CashSession.data_chiusura.is_(None))
            .order_by(CashSession.data_apertura.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return row


@router.post("/open", response_model=SessionRead, status_code=status.HTTP_201_CREATED)
async def open_session(
    payload: SessionOpen,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    active = (
        await db.execute(
            select(CashSession).where(CashSession.data_chiusura.is_(None))
        )
    ).scalar_one_or_none()
    if active:
        raise HTTPException(
            status_code=400,
            detail=f"Sessione già aperta (id={active.id}). Chiudila prima.",
        )
    sess = CashSession(
        data_apertura=datetime.now(UTC),
        utente=payload.utente or current_user.username,
        saldo_effettivo_apertura=payload.saldo_effettivo_apertura,
        saldo_contabile_apertura=payload.saldo_contabile_apertura,
        note=payload.note,
    )
    db.add(sess)
    await db.flush()
    await db.refresh(sess)
    return sess


@router.post("/{id}/close", response_model=SessionRead)
async def close_session(
    id: int,
    payload: SessionClose,
    db: AsyncSession = Depends(get_db),
):
    sess = await db.get(CashSession, id)
    if not sess:
        raise HTTPException(status_code=404, detail="Sessione non trovata")
    if sess.data_chiusura:
        raise HTTPException(status_code=400, detail="Sessione già chiusa")
    sess.data_chiusura = datetime.now(UTC)
    sess.saldo_effettivo_chiusura = payload.saldo_effettivo_chiusura
    sess.saldo_contabile_chiusura = payload.saldo_contabile_chiusura
    sess.differenza = payload.saldo_effettivo_chiusura - payload.saldo_contabile_chiusura
    if payload.note:
        sess.note = payload.note
    await db.flush()
    await db.refresh(sess)
    return sess
