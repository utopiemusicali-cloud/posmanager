from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.receipt_payment import ReceiptPayment


class ShopReceipt(Base):
    __tablename__ = "shop_receipts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    receipt_ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    numero_ricevuta: Mapped[str | None] = mapped_column(String(32))
    discount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    bonus: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    total_paid: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    cliente: Mapped[str | None] = mapped_column(String(255))
    items: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    d_items: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    metodo_pagamento: Mapped[str | None] = mapped_column(String(128))
    file_origine: Mapped[str | None] = mapped_column(String(512))
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    customer: Mapped[Customer | None] = relationship("Customer", back_populates="receipts")
    payments: Mapped[list[ReceiptPayment]] = relationship(
        "ReceiptPayment", back_populates="receipt",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
