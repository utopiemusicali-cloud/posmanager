"""Servizio inventario: query MySQL (inventory_items) + metadati Genre/Style/Year.
Ricerca vettorizzata, filtri facet, facets con conteggi.

Multi-tenant: ogni azienda ha il proprio DB (già isolato dal routing JWT),
quindi ogni InventoryService legge solo la tabella inventory_items della
propria azienda. Vedi get_inventory_service().
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.database import get_company_session_maker
from app.models.inventory_item import InventoryItem

_REQUIRED = ["source", "listing_id", "artist", "title", "label", "catno",
             "format", "price", "listed", "media_condition", "sleeve_condition",
             "location", "external_id", "comments", "quantity", "status", "release_id"]

_OUT_COLS = _REQUIRED + ["genre", "style", "year", "media_type"]

_SEARCH_COLS = ["listing_id", "artist", "title", "label", "catno",
                "format", "external_id", "comments", "location"]

# Range prezzo come su Discogs
PRICE_RANGES = [
    ("under5", "Meno di €5", 0, 5),
    ("5to10", "€5 - €10", 5, 10),
    ("10to15", "€10 - €15", 10, 15),
    ("15to20", "€15 - €20", 15, 20),
    ("20to40", "€20 - €40", 20, 40),
    ("over40", "Più di €40", 40, 10**9),
]


def _media_type(fmt: str) -> str:
    """Deriva il tipo di supporto dalle descrizioni format."""
    f = (fmt or "").lower()
    if "cdr" in f:
        return "CDr"
    if "cd" in f:
        return "CD"
    if "cass" in f or "tape" in f:
        return "Cassette"
    if "box" in f:
        return "Box Set"
    if any(t in f for t in ['12"', '7"', '10"', 'lp', 'vinyl', 'ep']):
        return "Vinyl"
    return "Altro"


def _parse_listed(series: pd.Series) -> pd.Series:
    """Il campo 'listed' mescola due formati: ISO da Discogs
    (2025-01-14 05:42:36) e italiano dagli articoli aggiunti a mano dal POS
    (14/01/2025 10:30). Prova i formati noti espliciti prima di lasciare
    che pandas indovini, altrimenti l'ambiguità giorno/mese sballa il sort."""
    dt = pd.to_datetime(series, format="%Y-%m-%d %H:%M:%S", errors="coerce")
    missing = dt.isna() & (series != "")
    if missing.any():
        dt.loc[missing] = pd.to_datetime(series[missing], format="%d/%m/%Y %H:%M", errors="coerce")
    missing = dt.isna() & (series != "")
    if missing.any():
        dt.loc[missing] = pd.to_datetime(series[missing], errors="coerce")
    return dt


async def _load_from_db(session_maker: async_sessionmaker, meta: dict[str, dict]) -> pd.DataFrame:
    async with session_maker() as db:
        rows = (await db.execute(select(InventoryItem))).scalars().all()

    if not rows:
        return pd.DataFrame(columns=_OUT_COLS + ["_blob", "_price"])

    records = []
    for item in rows:
        rid = str(item.release_id) if item.release_id else ""
        records.append({
            "source": item.source or "",
            "listing_id": item.listing_id or "",
            "artist": item.artist or "",
            "title": item.title or "",
            "label": item.label or "",
            "catno": item.catno or "",
            "format": item.format or "",
            "price": f"{item.price}" if item.price is not None else "",
            "listed": item.listed or "",
            "media_condition": item.media_condition or "",
            "sleeve_condition": item.sleeve_condition or "",
            "location": item.location or "",
            "external_id": item.external_id or "",
            "comments": item.comments or "",
            "quantity": item.quantity or 0,
            "status": item.status or "",
            "release_id": rid,
            "_item_genere": item.genere or "",
            "_item_stile": item.stile or "",
            "_item_year": item.year or "",
        })

    df = pd.DataFrame.from_records(records)

    if "listed" in df.columns:
        df["_dt"] = _parse_listed(df["listed"])
        df = df.sort_values("_dt", ascending=False, na_position="last").drop(columns=["_dt"])

    # Prezzo numerico
    df["_price"] = pd.to_numeric(df["price"], errors="coerce").fillna(0.0)

    # Tipo supporto
    df["media_type"] = df["format"].apply(_media_type)

    # Merge metadati Genre/Style/Year dal dict in memoria (caricato da release_meta)
    if meta:
        df["genre"] = df["release_id"].map(lambda r: meta.get(str(r), {}).get("genre", ""))
        df["style"] = df["release_id"].map(lambda r: meta.get(str(r), {}).get("style", ""))
        df["year"] = df["release_id"].map(lambda r: meta.get(str(r), {}).get("year", ""))
    else:
        df["genre"] = ""
        df["style"] = ""
        df["year"] = ""

    # Fallback sui valori inseriti a mano quando release_meta non ha (ancora) arricchito
    df["genre"] = df["genre"].where(df["genre"] != "", df["_item_genere"])
    df["style"] = df["style"].where(df["style"] != "", df["_item_stile"])
    df["year"] = df["year"].where(df["year"] != "", df["_item_year"])
    df = df.drop(columns=["_item_genere", "_item_stile", "_item_year"])

    # Blob ricerca
    blob_cols = [c for c in _SEARCH_COLS if c in df.columns]
    df["_blob"] = df[blob_cols].astype(str).agg(" ".join, axis=1).str.lower()

    return df.reset_index(drop=True)


def _explode_counts(series: pd.Series) -> dict[str, int]:
    """Conta valori multi-valore separati da virgola (genre, style, format desc)."""
    counts: dict[str, int] = {}
    for val in series:
        if not val:
            continue
        for tok in str(val).split(","):
            t = tok.strip()
            if t:
                counts[t] = counts.get(t, 0) + 1
    return counts


_CACHE_TTL = 30  # secondi: limita la staleness tra i processi worker uvicorn
# (la cache del DataFrame vive in RAM per-processo; .reload() esplicito dopo
# /sync raggiunge solo il worker che ha servito quella richiesta, gli altri
# si allineano da soli entro questo TTL).


class InventoryService:
    """Un'istanza per azienda (DB dedicato). Vedi get_inventory_service()."""

    def __init__(self, db_name: str) -> None:
        self._db_name = db_name
        self._session_maker = get_company_session_maker(db_name)
        self._df: pd.DataFrame | None = None
        self._meta: dict[str, dict] = {}
        self._loaded_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _ensure_loaded(self) -> pd.DataFrame:
        async with self._lock:
            if self._df is None or (time.time() - self._loaded_at) > _CACHE_TTL:
                self._df = await _load_from_db(self._session_maker, self._meta)
                self._loaded_at = time.time()
        return self._df

    async def reload(self) -> None:
        async with self._lock:
            self._df = None
        await self._ensure_loaded()

    def _apply_filters(self, df: pd.DataFrame, f: dict) -> pd.DataFrame:
        mask = pd.Series(True, index=df.index)

        if f.get("status"):
            mask &= df["status"].str.lower() == f["status"].lower()
        if f.get("source"):
            mask &= df["source"] == f["source"]
        if f.get("q"):
            mask &= df["_blob"].str.contains(f["q"].lower().strip(), regex=False, na=False)
        if f.get("media_type"):
            mask &= df["media_type"] == f["media_type"]
        if f.get("format_desc"):
            mask &= df["format"].str.contains(rf'(^|,\s*){f["format_desc"]}(\s*,|$)', regex=True, na=False)
        if f.get("media_condition"):
            mask &= df["media_condition"] == f["media_condition"]
        if f.get("sleeve_condition"):
            mask &= df["sleeve_condition"] == f["sleeve_condition"]
        if f.get("location"):
            mask &= df["location"] == f["location"]
        if f.get("genre"):
            mask &= df["genre"].str.contains(rf'(^|,\s*){f["genre"]}(\s*,|$)', regex=True, na=False)
        if f.get("style"):
            mask &= df["style"].str.contains(rf'(^|,\s*){f["style"]}(\s*,|$)', regex=True, na=False)
        if f.get("year"):
            mask &= df["year"] == str(f["year"])
        if f.get("price_min") is not None:
            mask &= df["_price"] >= float(f["price_min"])
        if f.get("price_max") is not None:
            mask &= df["_price"] <= float(f["price_max"])

        return df[mask]

    async def query(self, filters: dict, sort: str = "listed_desc",
                    offset: int = 0, limit: int = 100) -> tuple[int, list[dict[str, Any]]]:
        df = await self._ensure_loaded()
        filtered = self._apply_filters(df, filters)

        # Ordinamento (default: già ordinato per listed desc)
        if sort == "price_asc":
            filtered = filtered.sort_values("_price", ascending=True)
        elif sort == "price_desc":
            filtered = filtered.sort_values("_price", ascending=False)
        elif sort == "artist_asc":
            filtered = filtered.sort_values("artist", ascending=True)
        elif sort == "title_asc":
            filtered = filtered.sort_values("title", ascending=True)
        elif sort == "listed_asc":
            filtered = filtered.iloc[::-1]
        # listed_desc = ordine naturale (già applicato al load)

        total = len(filtered)
        page = filtered.iloc[offset: offset + limit]
        cols = [c for c in _OUT_COLS if c in page.columns]
        return total, page[cols].to_dict(orient="records")

    async def facets(self, status: str | None = None, q: str | None = None) -> dict:
        """Conteggi per ogni facet, sul set filtrato per status+search."""
        df = await self._ensure_loaded()
        base = self._apply_filters(df, {"status": status, "q": q})

        def vc(col: str, top: int = 30) -> list[dict]:
            s = base[base[col] != ""][col].value_counts().head(top)
            return [{"value": k, "count": int(v)} for k, v in s.items()]

        def vc_explode(col: str, top: int = 30) -> list[dict]:
            counts = _explode_counts(base[col])
            items = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:top]
            return [{"value": k, "count": v} for k, v in items]

        # Range prezzo
        price_facets = []
        for key, label, lo, hi in PRICE_RANGES:
            cnt = int(((base["_price"] >= lo) & (base["_price"] < hi if hi < 10**9 else base["_price"] >= lo)).sum()
                      if hi < 10**9 else (base["_price"] >= lo).sum())
            if hi < 10**9:
                cnt = int(((base["_price"] >= lo) & (base["_price"] < hi)).sum())
            if cnt:
                price_facets.append({"value": key, "label": label, "count": cnt, "min": lo, "max": hi})

        return {
            "sources": vc("source"),
            "media_types": vc("media_type"),
            "format_desc": vc_explode("format"),
            "price_ranges": price_facets,
            "media_conditions": vc("media_condition"),
            "sleeve_conditions": vc("sleeve_condition"),
            "locations": vc("location", top=50),
            "genres": vc_explode("genre"),
            "styles": vc_explode("style"),
            "years": vc("year", top=40),
        }

    async def unique_release_ids(self) -> list[str]:
        df = await self._ensure_loaded()
        return [r for r in df["release_id"].unique().tolist() if r]

    def set_meta(self, meta: dict[str, dict]) -> None:
        """Imposta il dict metadati (da DB) e invalida la cache del DataFrame."""
        self._meta = meta
        self._df = None  # forza ricostruzione al prossimo accesso

    async def unenriched_release_ids(self, limit: int) -> list[str]:
        ids = await self.unique_release_ids()
        out = [r for r in ids if str(r) not in self._meta]
        return out[:limit]

    async def enrich_progress(self) -> dict:
        ids = await self.unique_release_ids()
        enriched = sum(1 for r in ids if str(r) in self._meta)
        return {"total": len(ids), "enriched": enriched, "remaining": len(ids) - enriched}


# ── Cache istanze per azienda ─────────────────────────────────────────────────
_instances: dict[str, InventoryService] = {}


def get_inventory_service(db_name: str) -> InventoryService:
    """Restituisce (creando se serve) l'InventoryService dedicato all'azienda."""
    if db_name not in _instances:
        _instances[db_name] = InventoryService(db_name)
    return _instances[db_name]
