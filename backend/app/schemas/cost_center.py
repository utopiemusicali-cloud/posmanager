from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CostCenterCreate(BaseModel):
    data: datetime
    categoria: str
    importo: Decimal
    nota: str | None = None
    utente: str | None = None


class CostCenterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    data: datetime
    categoria: str
    importo: Decimal
    nota: str | None
    utente: str | None
    created_at: datetime


class CostCenterSummary(BaseModel):
    categoria: str
    totale: Decimal
