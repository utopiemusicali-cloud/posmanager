from __future__ import annotations

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.models.base import Base


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    listing_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    mode: Mapped[str] = mapped_column(String(20))  # "nod_unoff" | "inv_os"
    source: Mapped[str] = mapped_column(String(30))  # "NOD-UnOff" | "OS Records"

    # Testo libero (non vocabolario controllato): alcuni listing Discogs ci
    # incollano blob lunghi (l'intera descrizione della release) -> TEXT.
    artist: Mapped[str] = mapped_column(Text, default="")
    title: Mapped[str] = mapped_column(Text, default="")
    label: Mapped[str] = mapped_column(Text, default="")
    catno: Mapped[str] = mapped_column(Text, default="")
    format: Mapped[str] = mapped_column(Text, default="")
    release_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="For Sale")
    price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    listed: Mapped[str] = mapped_column(String(30), default="")
    comments: Mapped[str] = mapped_column(Text, default="")
    media_condition: Mapped[str] = mapped_column(String(100), default="")
    sleeve_condition: Mapped[str] = mapped_column(String(100), default="")
    accept_offer: Mapped[str] = mapped_column(String(1), default="N")
    external_id: Mapped[str] = mapped_column(Text, default="")
    weight: Mapped[int | None] = mapped_column(Integer, nullable=True)
    format_quantity: Mapped[int] = mapped_column(Integer, default=0)
    location: Mapped[str] = mapped_column(Text, default="")
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    country: Mapped[str] = mapped_column(String(100), default="")
    year: Mapped[str] = mapped_column(String(10), default="")
    genere: Mapped[str] = mapped_column(String(255), default="")
    stile: Mapped[str] = mapped_column(String(255), default="")

    add_date: Mapped[str] = mapped_column(String(30), default="")

    costo_unitario: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    url_discogs: Mapped[str] = mapped_column(String(500), default="")

    # Coda push verso Discogs: True quando un campo modificato in tabella
    # (source="Discogs") non è ancora stato rimandato all'inserzione reale
    # sul marketplace. Vedi app/services/discogs_push_worker.py.
    discogs_dirty: Mapped[bool] = mapped_column(Boolean, default=False)
    discogs_sync_error: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[str] = mapped_column(
        DateTime, server_default=func.now()
    )
