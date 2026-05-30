from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DeletionLog(Base):
    __tablename__ = "deletions_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False, index=True)
    utente_eliminazione: Mapped[str | None] = mapped_column(String(128))
    tipo_operazione: Mapped[str | None] = mapped_column(String(64))
    data_operazione: Mapped[str | None] = mapped_column(String(32))
    utente_operazione: Mapped[str | None] = mapped_column(String(128))
    nota: Mapped[str | None] = mapped_column(Text)
    importo: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    saldo: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    tipo_spesa: Mapped[str | None] = mapped_column(String(128))
    fornitore: Mapped[str | None] = mapped_column(String(255))
