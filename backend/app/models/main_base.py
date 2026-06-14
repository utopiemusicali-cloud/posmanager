from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class MainBase(DeclarativeBase):
    """Base per i modelli del DB principale (posmanager_main: companies, users)."""
    pass
