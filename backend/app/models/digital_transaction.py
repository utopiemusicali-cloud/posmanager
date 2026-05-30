from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DigitalTransaction(Base):
    __tablename__ = "digital_transactions"
    __table_args__ = (UniqueConstraint("fonte", "transaction_id", name="uq_digital_tx"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    fonte: Mapped[str] = mapped_column(String(32), nullable=False, index=True)  # SumUp | PayPal
    data: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    ora: Mapped[str | None] = mapped_column(String(8))
    transaction_id: Mapped[str | None] = mapped_column(String(128))
    importo: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    valuta: Mapped[str | None] = mapped_column(String(8))
    stato: Mapped[str | None] = mapped_column(String(64))
    tipo: Mapped[str | None] = mapped_column(String(64))
    carta: Mapped[str | None] = mapped_column(String(64))
    email: Mapped[str | None] = mapped_column(String(255))
    descrizione: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
