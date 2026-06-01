"""Servizio inventario: legge CSV Discogs. Ricerca vettorizzata + cache DataFrame."""
from __future__ import annotations

import asyncio
import glob
import os
from typing import Any

import pandas as pd

from app.config import settings

_CSV_DIR = settings.INVENTORY_CSV_DIR

_REQUIRED = ["source", "listing_id", "artist", "title", "label", "catno",
             "format", "price", "listed", "media_condition", "sleeve_condition",
             "location", "external_id", "comments", "quantity", "status", "release_id"]

# Colonne usate per la ricerca testuale (blob precalcolato)
_SEARCH_COLS = ["listing_id", "artist", "title", "label", "catno",
                "format", "external_id", "comments", "location"]


def _load_sync() -> pd.DataFrame:
    csvs = sorted(glob.glob(os.path.join(_CSV_DIR, "*.csv")), key=os.path.getmtime, reverse=True)
    if not csvs:
        return pd.DataFrame(columns=_REQUIRED + ["_blob"])

    df = pd.read_csv(csvs[0], dtype=str)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df["source"] = "Discogs"

    if "status" in df.columns:
        df["status"] = df["status"].fillna("").str.strip()

    # Ordina dal più recente
    if "listed" in df.columns:
        df["_dt"] = pd.to_datetime(df["listed"], dayfirst=True, errors="coerce", format="mixed")
        df = df.sort_values("_dt", ascending=False, na_position="last").drop(columns=["_dt"])

    for col in _REQUIRED:
        if col not in df.columns:
            df[col] = ""

    df = df.fillna("")

    # Blob di ricerca precalcolato (lowercase) — ricerca vettorizzata O(n) C-level
    blob_cols = [c for c in _SEARCH_COLS if c in df.columns]
    df["_blob"] = df[blob_cols].astype(str).agg(" ".join, axis=1).str.lower()

    return df.reset_index(drop=True)


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

    async def query(
        self,
        status_filter: str | None = None,
        search: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> tuple[int, list[dict[str, Any]]]:
        """Ritorna (total, items_paginati). Ricerca vettorizzata, niente copy."""
        df = await self._ensure_loaded()

        mask = None
        if status_filter and "status" in df.columns:
            mask = df["status"].str.lower() == status_filter.lower()

        if search:
            q = search.lower().strip()
            blob_mask = df["_blob"].str.contains(q, regex=False, na=False)
            mask = blob_mask if mask is None else (mask & blob_mask)

        filtered = df if mask is None else df[mask]
        total = len(filtered)

        page = filtered.iloc[offset: offset + limit]
        cols = [c for c in _REQUIRED if c in page.columns]
        return total, page[cols].to_dict(orient="records")
