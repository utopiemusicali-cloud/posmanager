from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CustomerCreate(BaseModel):
    nome: str
    tel: str | None = None
    mail: str | None = None
    instagram: str | None = None
    note: str | None = None


class CustomerUpdate(BaseModel):
    nome: str | None = None
    tel: str | None = None
    mail: str | None = None
    instagram: str | None = None
    note: str | None = None


class CustomerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    tel: str | None
    mail: str | None
    instagram: str | None
    note: str | None
    created_at: datetime
    updated_at: datetime
