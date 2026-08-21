"""Client SumUp per l'importazione delle transazioni (sola lettura).

Autenticazione con secret key (sup_sk_...) passata come Bearer token.
Nessuna funzione qui muove denaro: si leggono soltanto i movimenti per la
riconciliazione con cassa e ricevute.

La paginazione di SumUp non usa un numero di pagina ma un link "next" nella
risposta, che va seguito finche' esiste: ignorarlo significa importare solo
la prima pagina e credere che sia tutto.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import httpx

_BASE = "https://api.sumup.com"
_PAGE_LIMIT = 100

# Stati normalizzati in italiano, coerenti con quelli usati per PayPal, cosi'
# la scheda Transazioni li colora allo stesso modo indipendentemente dalla fonte.
_STATUS = {
    "SUCCESSFUL": "Completata",
    "PENDING": "In sospeso",
    "FAILED": "Fallita",
    "CANCELLED": "Annullata",
    "REFUNDED": "Rimborsata",
}


class SumUpError(RuntimeError):
    """Errore parlante, pensato per essere mostrato all'utente."""


def _headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code in (401, 403):
        raise SumUpError(
            "SumUp ha rifiutato la chiave API. Verifica di aver incollato una "
            "secret key valida (inizia con sup_sk_) e che non sia stata revocata."
        )
    if resp.status_code >= 400:
        raise SumUpError(f"SumUp ha risposto {resp.status_code}: {resp.text[:200]}")


async def get_profile(api_key: str) -> dict:
    """Profilo del merchant autenticato. Usato per verificare le credenziali
    senza importare nulla, e per mostrare a quale conto si e' collegati."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{_BASE}/v0.1/me", headers=_headers(api_key))
    _raise_for(resp)
    return resp.json()


def _amount(value: object) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def to_transaction(item: dict) -> dict | None:
    """Riduce una transazione SumUp ai campi di digital_transactions.
    None se manca l'identificativo, senza il quale non e' deduplicabile."""
    # transaction_code e' il codice che il commerciante vede su scontrini e
    # estratti conto: e' quello utile per la riconciliazione. id (UUID) resta
    # come ripiego se il codice non c'e'.
    tx_id = item.get("transaction_code") or item.get("id")
    if not tx_id:
        return None

    raw_ts = item.get("timestamp") or ""
    dt: datetime | None = None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            dt = datetime.strptime(raw_ts.replace("Z", "+0000"), fmt)
            break
        except (ValueError, TypeError):
            continue
    if dt is None:
        return None

    status = (item.get("status") or "").upper()
    return {
        "fonte": "SumUp",
        "transaction_id": str(tx_id),
        "data": dt.replace(tzinfo=None),
        "ora": dt.strftime("%H:%M:%S"),
        "importo": _amount(item.get("amount")),
        "valuta": item.get("currency"),
        "stato": _STATUS.get(status, status or None),
        "tipo": item.get("type") or item.get("payment_type"),
        "carta": item.get("card_type"),
        "email": item.get("user"),
        "descrizione": (item.get("product_summary") or "")[:2000] or None,
    }


async def fetch_transactions(
    api_key: str, merchant_code: str | None,
    start: date, end: date,
) -> list[dict]:
    """Tutte le transazioni del periodo, gia' normalizzate."""
    # Con il merchant code si interroga esplicitamente quel conto; senza, si
    # usa quello a cui la chiave e' associata.
    path = (
        f"/v0.1/merchants/{merchant_code}/transactions/history"
        if merchant_code else
        "/v0.1/me/transactions/history"
    )
    params: dict | None = {
        "limit": _PAGE_LIMIT,
        "order": "descending",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    url = f"{_BASE}{path}"
    out: list[dict] = []
    seen_urls: set[str] = set()

    async with httpx.AsyncClient(headers=_headers(api_key), timeout=60) as client:
        while url:
            resp = await client.get(url, params=params)
            _raise_for(resp)
            data = resp.json()

            for item in data.get("items", []):
                tx = to_transaction(item)
                if tx:
                    out.append(tx)

            # SumUp pagina con un link "next": i parametri sono gia' dentro
            # l'href, quindi vanno azzerati per non duplicarli.
            nxt = next(
                (l.get("href") for l in (data.get("links") or []) if l.get("rel") == "next"),
                None,
            )
            if not nxt or nxt in seen_urls:
                break  # guardia contro link che rimandano a se stessi
            seen_urls.add(nxt)
            url = nxt if nxt.startswith("http") else f"{_BASE}{nxt}"
            params = None

    return out


# ── Versamenti (payouts) ──────────────────────────────────────────────────────
# SumUp non espone il saldo del conto: i payouts sono il dato finanziario piu'
# vicino, cioe' i bonifici effettivamente accreditati sul conto corrente.

# Il tipo distingue gli accrediti dalle trattenute (storni, rimborsi, addebiti).
_PAYOUT_LABELS = {
    "PAYOUT": "Versamento",
    "CHARGE_BACK_DEDUCTION": "Trattenuta storno",
    "REFUND_DEDUCTION": "Trattenuta rimborso",
    "DD_RETURN_DEDUCTION": "Trattenuta insoluto",
    "BALANCE_DEDUCTION": "Trattenuta saldo",
}


async def get_merchant_code(api_key: str) -> str | None:
    """Il merchant code serve nel percorso dei payouts. Se l'utente non l'ha
    inserito nelle impostazioni lo si ricava dal profilo, per non costringerlo
    a cercarlo nel dashboard SumUp."""
    profile = await get_profile(api_key)
    return ((profile.get("merchant_profile") or {}).get("merchant_code")) or None


async def fetch_payouts(
    api_key: str, merchant_code: str,
    start: date, end: date,
) -> list[dict]:
    """Versamenti del periodo. A differenza delle transazioni questo endpoint
    richiede obbligatoriamente il merchant code nel percorso."""
    url = f"{_BASE}/v1.0/merchants/{merchant_code}/payouts"
    async with httpx.AsyncClient(headers=_headers(api_key), timeout=60) as client:
        resp = await client.get(url, params={
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        })
    _raise_for(resp)

    data = resp.json()
    items = data if isinstance(data, list) else data.get("items", [])

    out = []
    for p in items:
        tipo = (p.get("type") or "PAYOUT").upper()
        out.append({
            "id": p.get("id"),
            "data": p.get("date"),
            "tipo": tipo,
            "tipo_label": _PAYOUT_LABELS.get(tipo, tipo),
            "importo": float(p.get("amount") or 0),
            "commissione": float(p.get("fee") or 0),
            "valuta": p.get("currency"),
            "stato": p.get("status"),
            "riferimento": p.get("reference") or p.get("transaction_code") or "",
        })
    return out
