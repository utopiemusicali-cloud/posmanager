from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class TransactionUpsert(BaseModel):
    fonte: str
    data: datetime
    ora: str | None = None
    transaction_id: str | None = None
    importo: Decimal | None = None
    valuta: str | None = None
    stato: str | None = None
    tipo: str | None = None
    carta: str | None = None
    email: str | None = None
    descrizione: str | None = None


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    fonte: str
    data: datetime
    transaction_id: str | None
    importo: Decimal | None
    valuta: str | None
    stato: str | None
    tipo: str | None
    carta: str | None
    email: str | None
    descrizione: str | None
    created_at: datetime
