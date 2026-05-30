from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ExpenseCreate(BaseModel):
    data: datetime
    importo: Decimal
    nota: str | None = None
    fornitore: str | None = None
    ricevuta: str | None = None
    numero_ricevuta: str | None = None
    metodo_pagamento: str | None = None
    tipo_spesa: str | None = None
    utente: str | None = None


class ExpenseUpdate(BaseModel):
    importo: Decimal | None = None
    nota: str | None = None
    fornitore: str | None = None
    tipo_spesa: str | None = None
    metodo_pagamento: str | None = None


class ExpenseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    data: datetime
    importo: Decimal
    nota: str | None
    fornitore: str | None
    ricevuta: str | None
    numero_ricevuta: str | None
    metodo_pagamento: str | None
    tipo_spesa: str | None
    utente: str | None
    created_at: datetime
    updated_at: datetime
