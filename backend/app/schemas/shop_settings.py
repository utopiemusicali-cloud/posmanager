from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class ShopSettingsUpdate(BaseModel):
    ragione_sociale: str = ""
    indirizzo: str = ""
    cap: str = ""
    citta: str = ""
    provincia: str = ""
    codice_fiscale: str = ""
    piva: str | None = None
    numero_rea: str | None = None
    telefono: str | None = None
    email: str | None = None
    regime_fiscale: str = "margine"
    note_piede: str | None = None

    @field_validator("provincia")
    @classmethod
    def provincia_upper(cls, v: str) -> str:
        return v.upper()[:2]

    @field_validator("codice_fiscale")
    @classmethod
    def cf_upper(cls, v: str) -> str:
        return v.upper()


class ShopSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ragione_sociale: str
    indirizzo: str
    cap: str
    citta: str
    provincia: str
    codice_fiscale: str
    piva: str | None
    numero_rea: str | None
    telefono: str | None
    email: str | None
    regime_fiscale: str
    note_piede: str | None
    updated_at: datetime
