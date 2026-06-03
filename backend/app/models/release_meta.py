from __future__ import annotations

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.models.base import Base


class ReleaseMeta(Base):
    """Metadati Discogs completi per release_id (API ufficiale /releases/{id}).
    Campi estratti per filtri/etichette + raw_json con la risposta API intera.
    """
    __tablename__ = "release_meta"

    release_id: Mapped[str] = mapped_column(String(20), primary_key=True)

    # Identificativi base
    artist: Mapped[str] = mapped_column(String(255), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    label: Mapped[str] = mapped_column(String(255), default="")
    catno: Mapped[str] = mapped_column(String(100), default="")
    format: Mapped[str] = mapped_column(String(255), default="")
    year: Mapped[str] = mapped_column(String(10), default="")
    country: Mapped[str] = mapped_column(String(100), default="")
    released: Mapped[str] = mapped_column(String(20), default="")
    genre: Mapped[str] = mapped_column(String(255), default="")
    style: Mapped[str] = mapped_column(String(255), default="")
    barcode: Mapped[str] = mapped_column(String(120), default="")
    master_id: Mapped[str] = mapped_column(String(20), default="")

    # Immagini
    thumbnail: Mapped[str] = mapped_column(String(500), default="")
    cover_image: Mapped[str] = mapped_column(String(500), default="")

    # Community / mercato (snapshot al momento dell'arricchimento)
    have: Mapped[int | None] = mapped_column(Integer, nullable=True)
    want: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    rating_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    num_for_sale: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lowest_price: Mapped[float | None] = mapped_column(Float, nullable=True)

    notes: Mapped[str] = mapped_column(Text, default="")

    # Risposta API completa (tracklist, video, immagini, identifiers, companies...)
    raw_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)

    enriched_at: Mapped[str] = mapped_column(DateTime, server_default=func.now())
