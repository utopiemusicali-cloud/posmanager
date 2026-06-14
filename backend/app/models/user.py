from __future__ import annotations

from enum import Enum
from typing import ClassVar

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TimestampMixin
from app.models.main_base import MainBase


class UserRole(str, Enum):
    superadmin = "superadmin"
    admin = "admin"
    operator = "operator"
    viewer = "viewer"


class User(MainBase, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # None → superadmin (nessuna azienda specifica)
    company_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(16), nullable=False, default=UserRole.operator)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Attributo transitorio impostato da get_current_user (non mappato su DB)
    _company_db: ClassVar[str | None] = None
