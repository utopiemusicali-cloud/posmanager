from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.shop_receipt import ShopReceipt


class ReceiptPayment(Base):
    __tablename__ = "receipt_payments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(
        ForeignKey("shop_receipts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    metodo: Mapped[str] = mapped_column(String(64), nullable=False)
    importo: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    receipt: Mapped[ShopReceipt] = relationship("ShopReceipt", back_populates="payments")
