from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CashMovementCreate(BaseModel):
    movement_ts: datetime
    importo: Decimal
    utente: str | None = None
    nota: str | None = None
    fornitore: str | None = None
    tipo_spesa: str | None = None
    metodo_pagamento: str | None = None
    ricevuta: str | None = None
    numero_ricevuta: str | None = None


class CashMovementUpdate(BaseModel):
    importo: Decimal | None = None
    nota: str | None = None
    fornitore: str | None = None
    tipo_spesa: str | None = None
    metodo_pagamento: str | None = None


class CashMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    movement_ts: datetime
    importo: Decimal
    utente: str | None
    nota: str | None
    fornitore: str | None
    tipo_spesa: str | None
    metodo_pagamento: str | None
    ricevuta: str | None
    numero_ricevuta: str | None
    saldo: Decimal | None
    created_at: datetime
    updated_at: datetime
