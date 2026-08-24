from __future__ import annotations

from sqlalchemy import Boolean, String, Text
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
    # Sandbox di default: passare in produzione dev'essere una scelta esplicita,
    # non il comportamento che si ottiene dimenticando di configurare qualcosa.
    paypal_sandbox: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="1")
    # eBay. L'autenticazione ha due livelli: le credenziali dell'app
    # (app_id + cert_id) danno solo un token applicativo, sufficiente per i
    # dati pubblici. Le API Sell (Inventory, Fulfillment) richiedono un token
    # UTENTE, che si ottiene con il consenso via browser e produce un refresh
    # token a lunga durata: e' quello che va conservato qui.
    ebay_app_id: Mapped[str | None] = mapped_column(String(255))       # Client ID
    ebay_cert_id: Mapped[str | None] = mapped_column(String(255))      # Client Secret
    ebay_dev_id: Mapped[str | None] = mapped_column(String(255))
    ebay_ru_name: Mapped[str | None] = mapped_column(String(255))      # redirect per il consenso
    ebay_refresh_token: Mapped[str | None] = mapped_column(Text)       # oltre 255 caratteri
    ebay_sandbox: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="1")

    # Extra
    logo_url: Mapped[str | None] = mapped_column(String(512))
    currency: Mapped[str] = mapped_column(String(8), nullable=False, server_default="EUR")
