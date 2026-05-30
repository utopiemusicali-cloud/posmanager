from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    importo: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    nota: Mapped[str | None] = mapped_column(Text)
    fornitore: Mapped[str | None] = mapped_column(String(255))
    ricevuta: Mapped[str | None] = mapped_column(String(255))
    numero_ricevuta: Mapped[str | None] = mapped_column(String(32))
    metodo_pagamento: Mapped[str | None] = mapped_column(String(64))
    tipo_spesa: Mapped[str | None] = mapped_column(String(128), index=True)
    utente: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
