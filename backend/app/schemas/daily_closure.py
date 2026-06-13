from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class IvaAliquota(BaseModel):
    aliquota: str           # "22", "10", "4", "0", "Esente", "Margine"
    lordo: Decimal
    imponibile: Decimal
    imposta: Decimal


class ClosureCreate(BaseModel):
    closure_ts: datetime
    saldo_contabile: Decimal
    effettivo_cassa: Decimal
    utente: str | None = None
    note: str | None = None
    tipo: str = "Chiusura"
    # corrispettivi (opzionale — se omessi vengono calcolati automaticamente)
    totale_corrispettivi: Decimal | None = None
    n_ricevute: int | None = None
    canali_json: str | None = None   # JSON stringificato
    iva_json: str | None = None      # JSON stringificato
    numero_rt: str | None = None


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
    totale_corrispettivi: Decimal | None
    n_ricevute: int | None
    canali_json: str | None
    iva_json: str | None
    numero_rt: str | None
    created_at: datetime


class ClosurePreview(BaseModel):
    """Anteprima corrispettivi del giorno, calcolata dalle ricevute."""
    data: datetime
    totale_corrispettivi: Decimal
    n_ricevute: int
    canali: dict[str, Decimal]   # {"Contanti": X, "SumUp": Y, "PayPal": Z}
