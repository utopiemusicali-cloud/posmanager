"""Servizio inventario: legge CSV Discogs + file Excel locali.
I percorsi sono configurabili via env (INVENTORY_CSV_DIR, NOD_UNOFF_PATH, INVENTARIO_OS_PATH).
"""
from __future__ import annotations

import asyncio
import glob
import os
from functools import lru_cache
from typing import Any

import pandas as pd

from app.config import settings

_CSV_DIR = settings.INVENTORY_CSV_DIR
_NOD_UNOFF = os.getenv(
    "NOD_UNOFF_PATH",
    r"G:\Il mio Drive\PointOfSale\Magazzino\NOD - UnOFF\NOD-UNOFF.xlsx",
)
_INVENTARIO_OS = os.getenv(
    "INVENTARIO_OS_PATH",
    r"G:\Il mio Drive\PointOfSale\Magazzino\Prodotti OS\INVENTARIO OS.xlsx",
)

_COLS = [
    "source", "listing_id", "artist", "title", "label", "catno",
    "format", "price", "listed", "media_condition", "sleeve_condition",
    "location", "external_id", "comments", "quantity", "status",
    "release_id",
]


def _load_sync() -> pd.DataFrame:
    frames: list[pd.DataFrame] = []

    csvs = sorted(glob.glob(os.path.join(_CSV_DIR, "*.csv")), key=os.path.getmtime, reverse=True)
    if csvs:
        df = pd.read_csv(csvs[0], dtype=str)
        df.columns = [c.strip().lower() for c in df.columns]
        df["source"] = "Discogs"
        frames.append(df)

    if os.path.exists(_NOD_UNOFF):
        df = pd.read_excel(_NOD_UNOFF, sheet_name="NOD-UNOFF", dtype=str)
        df.columns = [c.strip().lower() for c in df.columns]
        df["source"] = "NOD-UnOff"
        frames.append(df)

    if os.path.exists(_INVENTARIO_OS):
        df = pd.read_excel(_INVENTARIO_OS, sheet_name="Inventario", dtype=str)
        df.columns = [c.strip().lower() for c in df.columns]
        df["source"] = "OS Records"
        frames.append(df)

    if not frames:
        return pd.DataFrame(columns=_COLS)

    combined = pd.concat(frames, ignore_index=True, sort=False)

    if "status" in combined.columns:
        combined["status"] = combined["status"].fillna("").str.strip()

    if "listed" in combined.columns:
        combined["_dt"] = pd.to_datetime(combined["listed"], dayfirst=True, errors="coerce", format="mixed")
        combined = combined.sort_values("_dt", ascending=False, na_position="last").drop(columns=["_dt"])

    for col in _COLS:
        if col not in combined.columns:
            combined[col] = ""

    return combined.fillna("")[_COLS]


class InventoryService:
    def __init__(self) -> None:
        self._df: pd.DataFrame | None = None
        self._lock = asyncio.Lock()

    async def _ensure_loaded(self) -> pd.DataFrame:
        async with self._lock:
            if self._df is None:
                loop = asyncio.get_event_loop()
                self._df = await loop.run_in_executor(None, _load_sync)
        return self._df

    async def reload(self) -> None:
        async with self._lock:
            self._df = None
        await self._ensure_loaded()

    async def load_all(
        self,
        status_filter: str | None = None,
        search: str | None = None,
    ) -> list[dict[str, Any]]:
        df = (await self._ensure_loaded()).copy()

        if status_filter and "status" in df.columns:
            df = df[df["status"].str.lower() == status_filter.lower()]

        if search:
            q = search.lower()
            mask = df[_COLS].apply(lambda r: any(q in str(v).lower() for v in r), axis=1)
            df = df[mask]

        return df.to_dict(orient="records")
