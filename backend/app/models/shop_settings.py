from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ShopSettings(Base):
    __tablename__ = "shop_settings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    _empty = text("''")
    ragione_sociale: Mapped[str] = mapped_column(String(255), nullable=False, server_default=_empty)
    indirizzo: Mapped[str] = mapped_column(String(255), nullable=False, server_default=_empty)
    cap: Mapped[str] = mapped_column(String(10), nullable=False, server_default=_empty)
    citta: Mapped[str] = mapped_column(String(100), nullable=False, server_default=_empty)
    provincia: Mapped[str] = mapped_column(String(2), nullable=False, server_default=_empty)
    codice_fiscale: Mapped[str] = mapped_column(String(16), nullable=False, server_default=_empty)
    piva: Mapped[str | None] = mapped_column(String(11))
    # Numero REA Camera di Commercio, es. "MI-1234567" — richiesto per file Entratel
    numero_rea: Mapped[str | None] = mapped_column(String(20))
    telefono: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(255))
    # "margine" (usato D.L. 41/95) | "ordinario"
    regime_fiscale: Mapped[str] = mapped_column(String(32), nullable=False, server_default=text("'margine'"))
    note_piede: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
