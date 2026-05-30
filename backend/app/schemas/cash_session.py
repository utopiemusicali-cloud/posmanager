from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class SessionOpen(BaseModel):
    utente: str | None = None
    saldo_effettivo_apertura: Decimal
    saldo_contabile_apertura: Decimal | None = None
    note: str | None = None


class SessionClose(BaseModel):
    saldo_effettivo_chiusura: Decimal
    saldo_contabile_chiusura: Decimal
    note: str | None = None


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    data_apertura: datetime
    utente: str | None
    saldo_effettivo_apertura: Decimal | None
    saldo_contabile_apertura: Decimal | None
    data_chiusura: datetime | None
    saldo_effettivo_chiusura: Decimal | None
    saldo_contabile_chiusura: Decimal | None
    differenza: Decimal | None
    note: str | None
    created_at: datetime

    @property
    def is_open(self) -> bool:
        return self.data_chiusura is None
