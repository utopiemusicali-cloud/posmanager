from __future__ import annotations

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    total: int
    items: list[T]
    page: int
    page_size: int


class DateRange(BaseModel):
    da: datetime | None = None
    a: datetime | None = None


class MessageResponse(BaseModel):
    message: str
    ok: bool = True
