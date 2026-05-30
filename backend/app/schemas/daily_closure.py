from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ClosureCreate(BaseModel):
    closure_ts: datetime
    saldo_contabile: Decimal
    effettivo_cassa: Decimal
    utente: str | None = None
    note: str | None = None
    tipo: str = "Chiusura"


class ClosureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    closure_ts: datetime
    saldo_contabile: Decimal
    effettivo_cassa: Decimal
    differenza: Decimal
    utente: str | None
    note: str | None
    tipo: str
    created_at: datetime
