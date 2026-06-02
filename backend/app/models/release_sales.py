from __future__ import annotations

from sqlalchemy import JSON, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.models.base import Base


class ReleaseSales(Base):
    """Dati vendita + mercato di una release (scraping Discogs).
    Riutilizzabile da Inventario, Etichette, Items History Sales.
    """
    __tablename__ = "release_sales"

    release_id: Mapped[str] = mapped_column(String(20), primary_key=True)

    # Aggregati storico vendite
    sales_count: Mapped[int] = mapped_column(Integer, default=0)
    min_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_sold_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_sold_date: Mapped[str] = mapped_column(String(20), default="")

    # Statistiche community / mercato
    have: Mapped[int | None] = mapped_column(Integer, nullable=True)
    want: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    ratings_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    items_for_sale: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Array dettaglio (JSON)
    sales_history: Mapped[list] = mapped_column(JSON, default=list)     # [{date, media, sleeve, price, currency}]
    market_listings: Mapped[list] = mapped_column(JSON, default=list)   # [{seller, feedback_pct, feedback_count, ship_from, media, sleeve, price, shipping, total, currency}]

    sales_scraped_at: Mapped[str | None] = mapped_column(DateTime, nullable=True)
    market_scraped_at: Mapped[str | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[str] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
