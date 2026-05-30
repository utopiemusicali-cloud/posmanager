"""Recupera e gestisce gli ordini del marketplace Discogs."""
from __future__ import annotations

import re
from typing import Any

import httpx

_BASE = "https://api.discogs.com"
_UA = "posmanager/1.0 +https://github.com/utopiemusicali-cloud/posmanager"

ORDER_STATUSES = [
    "All", "New Order", "Invoice Sent", "Payment Pending",
    "Payment Received", "In Progress", "Shipped", "Merged", "Order Changed",
    "Cancelled (Non-Paying Buyer)", "Cancelled (Item Unavailable)",
    "Cancelled (Per Buyer's Request)", "Cancelled",
]


def _flatten(order: dict) -> dict:
    """Appiattisce l'ordine Discogs per accesso diretto ai campi nested."""
    flat: dict[str, Any] = {}

    def _rec(obj: Any, prefix: str = "") -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                key = f"{prefix}.{k}" if prefix else k
                if isinstance(v, (dict, list)) and k not in ("items", "next_status", "tax"):
                    _rec(v, key)
                else:
                    flat[key] = v
        else:
            flat[prefix] = obj

    _rec(order)
    if "items" in order:
        flat["items"] = order["items"]
    if "tax" in order:
        flat["tax"] = order["tax"]
    return flat


def _tracking_url(tracking: str, method: str) -> str:
    t, m = tracking.strip(), (method or "").lower()
    if "brt" in m or "bartolini" in m:
        return "https://services.brt.it/it/tracking"
    if "postnl" in m or t.startswith("3S"):
        return f"https://mailingtechnology.com/tracking/?tn={t}&testMode=0"
    if "ups" in m or t.startswith("1Z"):
        return f"https://www.ups.com/track?tracknum={t}&loc=it_IT"
    if "poste" in m or "posta" in m:
        return f"https://business.poste.it/professionisti-imprese/cerca/index.html#!/risultati-spedizioni/{t}"
    if len(t) == 13 and t.isdigit():
        return "https://services.brt.it/it/tracking"
    if t.startswith("1Z"):
        return f"https://www.ups.com/track?tracknum={t}&loc=it_IT"
    if t.startswith("3S"):
        return f"https://mailingtechnology.com/tracking/?tn={t}&testMode=0"
    return "https://services.brt.it/it/tracking"


def _extract_tracking(messages: list[dict]) -> str:
    for msg in messages:
        text = msg.get("message", "")
        m = re.search(r"mailingtechnology\.com/tracking/\?tn=([A-Za-z0-9]+)", text)
        if m:
            return m.group(1)
        m = re.search(r"ups\.com/track\?tracknum=([A-Za-z0-9]+)", text)
        if m:
            return m.group(1)
        m = re.search(r"risultati-spedizioni/([A-Za-z0-9]+)", text)
        if m:
            return m.group(1)
        m = re.search(r"\b(3S[A-Z0-9]{10,})\b", text)
        if m:
            return m.group(1)
        m = re.search(r"\b(1Z[A-Z0-9]{16})\b", text)
        if m:
            return m.group(1)
    return ""


async def fetch_all_orders(token: str, year: int) -> list[dict]:
    """Scarica TUTTI gli ordini per l'anno specificato (tutte le pagine)."""
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA}
    all_orders: list[dict] = []

    async with httpx.AsyncClient(headers=headers, timeout=60) as client:
        page = 1
        while True:
            params = {"per_page": 50, "sort": "created", "sort_order": "desc", "page": page}
            resp = await client.get(f"{_BASE}/marketplace/orders", params=params)
            resp.raise_for_status()
            data = resp.json()
            orders = data.get("orders", [])
            if not orders:
                break

            stop = False
            for o in orders:
                created = o.get("created", "")
                if created and int(created[:4]) < year:
                    stop = True
                    break
                if created and int(created[:4]) == year:
                    flat = _flatten(o)
                    all_orders.append(flat)

            pages = data.get("pagination", {}).get("pages", 1)
            if stop or page >= pages:
                break
            page += 1

    return all_orders


async def fetch_orders(
    token: str,
    status: str = "All",
    sort_order: str = "desc",
    page: int = 1,
    per_page: int = 50,
) -> dict:
    """Recupera ordini paginati (per visualizzazione semplice)."""
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA}
    params: dict = {"sort": "created", "sort_order": sort_order, "page": page, "per_page": per_page}
    if status and status != "All":
        params["status"] = status

    async with httpx.AsyncClient(headers=headers, timeout=30) as client:
        resp = await client.get(f"{_BASE}/marketplace/orders", params=params)
        resp.raise_for_status()
        data = resp.json()

    orders = [_flatten(o) for o in data.get("orders", [])]
    pagination = data.get("pagination", {})
    return {
        "orders": orders,
        "total": pagination.get("items", 0),
        "pages": pagination.get("pages", 1),
        "page": page,
        "per_page": per_page,
    }


async def get_order_messages(token: str, order_id: str) -> list[dict]:
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA}
    async with httpx.AsyncClient(headers=headers, timeout=20) as client:
        resp = await client.get(f"{_BASE}/marketplace/orders/{order_id}/messages")
        resp.raise_for_status()
        return resp.json().get("messages", [])


async def mark_as_shipped(
    token: str, order_id: str, tracking: str,
    buyer: str = "", shipping_method: str = ""
) -> bool:
    tracking_link = _tracking_url(tracking, shipping_method)
    greeting = f"Hello {buyer}" if buyer else "Hello"
    message = (
        f"{greeting},\n"
        f"Your order is on the way! You can check the shipping progress here:\n"
        f"{tracking_link}\n\n"
        f"Thx for choosing Oblique Strategies Records!"
    )
    headers = {
        "Authorization": f"Discogs token={token}",
        "Content-Type": "application/json",
        "User-Agent": _UA,
    }
    async with httpx.AsyncClient(headers=headers, timeout=20) as client:
        resp = await client.post(
            f"{_BASE}/marketplace/orders/{order_id}/messages",
            json={"status": "Shipped", "message": message},
        )
    return resp.status_code == 201


async def cancel_order(token: str, order_id: str, reason: str) -> bool:
    headers = {
        "Authorization": f"Discogs token={token}",
        "Content-Type": "application/json",
        "User-Agent": _UA,
    }
    async with httpx.AsyncClient(headers=headers, timeout=20) as client:
        resp = await client.post(
            f"{_BASE}/marketplace/orders/{order_id}/messages",
            json={"status": "Cancelled", "message": reason},
        )
    return resp.status_code == 201
