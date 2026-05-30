from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DailyClosure(Base):
    __tablename__ = "daily_closures"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    closure_ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    saldo_contabile: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    effettivo_cassa: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    differenza: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    utente: Mapped[str | None] = mapped_column(String(128))
    note: Mapped[str | None] = mapped_column(Text)
    tipo: Mapped[str] = mapped_column(String(32), default="Chiusura", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
