from __future__ import annotations

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.models.base import Base


class ReleaseMeta(Base):
    """Metadati Discogs per release_id — popolati dall'arricchimento.
    Persistono in DB e servono per filtri inventario + stampa etichette.
    """
    __tablename__ = "release_meta"

    release_id: Mapped[str] = mapped_column(String(20), primary_key=True)

    artist: Mapped[str] = mapped_column(String(255), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    label: Mapped[str] = mapped_column(String(255), default="")
    catno: Mapped[str] = mapped_column(String(100), default="")
    format: Mapped[str] = mapped_column(String(255), default="")
    year: Mapped[str] = mapped_column(String(10), default="")
    country: Mapped[str] = mapped_column(String(100), default="")
    genre: Mapped[str] = mapped_column(String(255), default="")
    style: Mapped[str] = mapped_column(String(255), default="")
    thumbnail: Mapped[str] = mapped_column(String(500), default="")
    cover_image: Mapped[str] = mapped_column(String(500), default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    enriched_at: Mapped[str] = mapped_column(DateTime, server_default=func.now())
