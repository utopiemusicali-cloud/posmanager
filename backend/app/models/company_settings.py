from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CompanySettings(Base, TimestampMixin):
    """Token e credenziali di integrazione per ogni azienda (1 riga per DB aziendale)."""
    __tablename__ = "company_settings_integrations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # Discogs
    discogs_token: Mapped[str | None] = mapped_column(String(255))
    discogs_username: Mapped[str | None] = mapped_column(String(128))
    discogs_password: Mapped[str | None] = mapped_column(String(255))
    # SumUp
    sumup_api_key: Mapped[str | None] = mapped_column(String(255))
    sumup_merchant_code: Mapped[str | None] = mapped_column(String(64))
    # PayPal
    paypal_client_id: Mapped[str | None] = mapped_column(String(255))
    paypal_client_secret: Mapped[str | None] = mapped_column(String(255))
    # Extra
    logo_url: Mapped[str | None] = mapped_column(String(512))
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="EUR")
