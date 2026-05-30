from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

CATEGORIE = [
    "BAR", "CANC", "SHOP", "PULIZIA", "SPED", "DISCHI",
    "UTENZE", "ANTICIPO", "SALDO", "VARIE", "VIAGGI", "MANUTENZIONE",
]


class CostCenter(Base):
    __tablename__ = "cost_centers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    categoria: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    importo: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    nota: Mapped[str | None] = mapped_column(Text)
    utente: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
