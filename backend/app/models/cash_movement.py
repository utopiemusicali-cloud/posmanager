from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CashMovement(Base):
    __tablename__ = "cash_movements"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    movement_ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    utente: Mapped[str | None] = mapped_column(String(128))
    nota: Mapped[str | None] = mapped_column(Text)
    importo: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    fornitore: Mapped[str | None] = mapped_column(String(255))
    tipo_spesa: Mapped[str | None] = mapped_column(String(128), index=True)
    metodo_pagamento: Mapped[str | None] = mapped_column(String(64), index=True)
    ricevuta: Mapped[str | None] = mapped_column(String(255))
    numero_ricevuta: Mapped[str | None] = mapped_column(String(32))
    saldo: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
