"""Scarica i metadati di un release da Discogs (per arricchimento inventario).
Solo chiamate API: il salvataggio su DB lo gestisce il router.
Salva i campi estratti + l'intera risposta JSON (raw_json).
"""
from __future__ import annotations

import asyncio
import json

import httpx

_UA = "posmanager/1.0 +https://oblique.example"


def _parse_release(rid: str, d: dict) -> dict:
    artists = d.get("artists") or []
    artist = " / ".join(a.get("name", "").strip() for a in artists if a.get("name"))
    labels = d.get("labels") or []
    label = labels[0].get("name", "").strip() if labels else ""
    catno = labels[0].get("catno", "").strip() if labels else ""
    formats = d.get("formats") or []
    fmt = ""
    if formats:
        name = formats[0].get("name", "").strip()
        descs = ", ".join(str(x) for x in (formats[0].get("descriptions") or []) if x)
        fmt = f"{name}, {descs}".strip(", ")
    images = d.get("images") or []
    thumb = images[0].get("uri150", "") if images else d.get("thumb", "")
    cover = images[0].get("uri", "") if images else ""

    # Barcode dagli identifiers
    barcode = ""
    for ident in (d.get("identifiers") or []):
        if str(ident.get("type", "")).lower() == "barcode":
            barcode = str(ident.get("value", "")).strip()
            break

    community = d.get("community") or {}
    rating = community.get("rating") or {}

    return {
        "release_id": str(rid),
        "artist": artist,
        "title": d.get("title", "").strip(),
        "label": label,
        "catno": catno,
        "format": fmt,
        "year": str(d.get("year") or ""),
        "country": d.get("country", "").strip(),
        "released": str(d.get("released") or ""),
        "genre": ", ".join(d.get("genres") or []),
        "style": ", ".join(d.get("styles") or []),
        "barcode": barcode,
        "master_id": str(d.get("master_id") or ""),
        "thumbnail": thumb,
        "cover_image": cover,
        "have": community.get("have"),
        "want": community.get("want"),
        "rating_avg": rating.get("average"),
        "rating_count": rating.get("count"),
        "num_for_sale": d.get("num_for_sale"),
        "lowest_price": d.get("lowest_price"),
        "notes": (d.get("notes") or "")[:5000],
        "raw_json": json.dumps(d, ensure_ascii=False),
    }


_EMPTY = {"artist": "", "title": "", "label": "", "catno": "", "format": "",
          "year": "", "country": "", "released": "", "genre": "", "style": "",
          "barcode": "", "master_id": "", "thumbnail": "", "cover_image": "",
          "have": None, "want": None, "rating_avg": None, "rating_count": None,
          "num_for_sale": None, "lowest_price": None, "notes": "", "raw_json": None}


async def fetch_release_meta(token: str, release_ids: list[str]) -> list[dict]:
    """Scarica i metadati per una lista di release_id. ~55/min (sotto il limite)."""
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA}
    out: list[dict] = []
    async with httpx.AsyncClient(headers=headers, timeout=20) as client:
        for rid in release_ids:
            if not rid:
                continue
            try:
                r = await client.get(f"https://api.discogs.com/releases/{rid}")
                if r.status_code == 200:
                    out.append(_parse_release(rid, r.json()))
                elif r.status_code == 404:
                    out.append({"release_id": str(rid), **_EMPTY})
            except Exception:
                pass
            await asyncio.sleep(1.1)
    return out
