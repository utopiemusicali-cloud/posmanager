from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CashSession(Base):
    """Sessioni di cassa (apertura/chiusura). Chiamata CashSession per evitare
    conflitto con sqlalchemy.orm.Session."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data_apertura: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    utente: Mapped[str | None] = mapped_column(String(128))
    saldo_effettivo_apertura: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    saldo_contabile_apertura: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    data_chiusura: Mapped[datetime | None] = mapped_column(DateTime)
    saldo_effettivo_chiusura: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    saldo_contabile_chiusura: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    differenza: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
