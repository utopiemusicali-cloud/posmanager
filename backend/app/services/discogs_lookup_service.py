"""Cerca i dati di un release Discogs a partire dall'URL della pagina."""
from __future__ import annotations

import re

import httpx

_BASE = "https://api.discogs.com"
_UA = "posmanager/1.0 +https://github.com/utopiemusicali-cloud/posmanager"


def extract_release_id(url: str) -> int | None:
    m = re.search(r"/release/(\d+)", url)
    return int(m.group(1)) if m else None


async def lookup_release(token: str, url: str) -> dict:
    release_id = extract_release_id(url)
    if release_id is None:
        raise ValueError("URL non valido: release_id non trovato")

    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA}
    async with httpx.AsyncClient(headers=headers, timeout=15) as client:
        resp = await client.get(f"{_BASE}/releases/{release_id}")
        resp.raise_for_status()
        data = resp.json()

    artists = data.get("artists") or []
    artist = " / ".join(a.get("name", "").strip() for a in artists if a.get("name"))

    labels = data.get("labels") or []
    label = labels[0].get("name", "").strip() if labels else ""
    catno = labels[0].get("catno", "").strip() if labels else ""

    formats = data.get("formats") or []
    fmt = ""
    format_quantity = 1
    weight = 230
    if formats:
        f0 = formats[0]
        name = f0.get("name", "").strip()
        descs = ", ".join(str(d) for d in (f0.get("descriptions") or []) if d)
        fmt = f"{name}, {descs}".strip(", ")
        try:
            format_quantity = int(float(str(f0.get("qty", 1))))
        except Exception:
            pass
        for wk in ("weight", "estimated_weight"):
            w = f0.get(wk)
            if w:
                try:
                    weight = int(float(str(w)))
                    break
                except Exception:
                    pass

    genres = ", ".join(str(g) for g in (data.get("genres") or []) if g)
    styles = ", ".join(str(s) for s in (data.get("styles") or []) if s)

    return {
        "release_id": release_id,
        "artist": artist,
        "title": data.get("title", "").strip(),
        "label": label,
        "catno": catno,
        "format": fmt,
        "format_quantity": format_quantity,
        "weight": weight,
        "country": data.get("country", "").strip(),
        "year": str(data.get("year", "") or ""),
        "genere": genres,
        "stile": styles,
    }
