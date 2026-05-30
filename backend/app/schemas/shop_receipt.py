from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ReceiptCreate(BaseModel):
    receipt_ts: datetime
    total_paid: Decimal
    numero_ricevuta: str | None = None
    discount: Decimal = Decimal("0")
    bonus: Decimal = Decimal("0")
    cliente: str | None = None
    items: int = 0
    d_items: int = 0
    metodo_pagamento: str | None = None
    file_origine: str | None = None
    customer_id: int | None = None


class ReceiptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    receipt_ts: datetime
    numero_ricevuta: str | None
    discount: Decimal
    bonus: Decimal
    total_paid: Decimal
    cliente: str | None
    items: int
    d_items: int
    metodo_pagamento: str | None
    customer_id: int | None
    created_at: datetime


class NextReceiptNumber(BaseModel):
    numero: int
