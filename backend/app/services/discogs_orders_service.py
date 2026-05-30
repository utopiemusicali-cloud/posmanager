"""Recupera gli ordini del marketplace Discogs tramite API ufficiale."""
from __future__ import annotations

import httpx

_BASE = "https://api.discogs.com"
_UA = "posmanager/1.0 +https://github.com/utopiemusicali-cloud/posmanager"

# Tutti gli stati possibili degli ordini Discogs
ORDER_STATUSES = [
    "All",
    "New Order",
    "Invoice Sent",
    "Payment Pending",
    "Payment Received",
    "In Progress",
    "Shipped",
    "Merged",
    "Order Changed",
    "Cancelled (Non-Paying Buyer)",
    "Cancelled (Item Unavailable)",
    "Cancelled (Per Buyer's Request)",
    "Cancelled",
]


async def fetch_orders(
    token: str,
    status: str = "All",
    sort: str = "created",
    sort_order: str = "desc",
    page: int = 1,
    per_page: int = 50,
) -> dict:
    headers = {"Authorization": f"Discogs token={token}", "User-Agent": _UA}
    params: dict = {"sort": sort, "sort_order": sort_order, "page": page, "per_page": per_page}
    if status and status != "All":
        params["status"] = status

    async with httpx.AsyncClient(headers=headers, timeout=30) as client:
        resp = await client.get(f"{_BASE}/marketplace/orders", params=params)
        resp.raise_for_status()
        data = resp.json()

    orders = []
    for o in data.get("orders", []):
        items = o.get("items", [])
        release_desc = ""
        media_condition = ""
        sleeve_condition = ""
        listing_id = None
        if items:
            first = items[0]
            release_desc = first.get("release", {}).get("description", "")
            media_condition = first.get("media_condition", "")
            sleeve_condition = first.get("sleeve_condition", "")
            listing_id = first.get("id")

        total = o.get("total", {})
        shipping = o.get("shipping", {})
        fee = o.get("fee", {})
        buyer = o.get("buyer", {})

        orders.append({
            "id": o.get("id"),
            "uri": o.get("uri", ""),
            "status": o.get("status", ""),
            "created": o.get("created", "")[:10] if o.get("created") else "",
            "buyer": buyer.get("username", ""),
            "buyer_url": f"https://www.discogs.com/user/{buyer.get('username', '')}",
            "release": release_desc,
            "listing_id": listing_id,
            "media_condition": media_condition,
            "sleeve_condition": sleeve_condition,
            "items_count": len(items),
            "price": total.get("value", 0),
            "currency": total.get("currency", "EUR"),
            "shipping": shipping.get("value", 0),
            "fee": fee.get("value", 0),
            "messages_url": o.get("messages_url", ""),
        })

    pagination = data.get("pagination", {})
    return {
        "orders": orders,
        "total": pagination.get("items", 0),
        "pages": pagination.get("pages", 1),
        "page": page,
        "per_page": per_page,
    }
