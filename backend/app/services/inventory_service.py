"""Servizio inventario: legge CSV Discogs + file Excel locali."""
from __future__ import annotations

import asyncio
import glob
import os
from typing import Any

import pandas as pd

from app.config import settings

_CSV_DIR = settings.INVENTORY_CSV_DIR

# Colonne minime garantite anche se mancano nel file
_REQUIRED = ["source", "listing_id", "artist", "title", "label", "catno",
             "format", "price", "listed", "media_condition", "sleeve_condition",
             "location", "external_id", "comments", "quantity", "status", "release_id"]


def _load_sync() -> pd.DataFrame:
    frames: list[pd.DataFrame] = []

    # CSV Discogs (prende il più recente)
    csvs = sorted(glob.glob(os.path.join(_CSV_DIR, "*.csv")), key=os.path.getmtime, reverse=True)
    if csvs:
        df = pd.read_csv(csvs[0], dtype=str)
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
        df["source"] = "Discogs"
        frames.append(df)

    if not frames:
        return pd.DataFrame(columns=_REQUIRED)

    combined = pd.concat(frames, ignore_index=True, sort=False)

    if "status" in combined.columns:
        combined["status"] = combined["status"].fillna("").str.strip()

    # Ordina dal più recente
    if "listed" in combined.columns:
        combined["_dt"] = pd.to_datetime(combined["listed"], dayfirst=True, errors="coerce", format="mixed")
        combined = combined.sort_values("_dt", ascending=False, na_position="last").drop(columns=["_dt"])

    # Garantisce le colonne minime
    for col in _REQUIRED:
        if col not in combined.columns:
            combined[col] = ""

    return combined.fillna("")


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
            mask = df.apply(lambda r: any(q in str(v).lower() for v in r), axis=1)
            df = df[mask]

        return df.to_dict(orient="records")
