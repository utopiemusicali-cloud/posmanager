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
    # Uno spazio o un a capo incollati insieme alla chiave producono un 401
    # indistinguibile da una chiave sbagliata: si ripuliscono qui, cosi' vale
    # anche per le chiavi gia' salvate in passato.
    return {
        "Authorization": "Bearer " + (api_key or "").strip(),
        "Content-Type": "application/json",
    }


def _raise_for(resp: httpx.Response) -> None:
    # 401 e 403 hanno cause opposte e vanno tenuti distinti: nel primo caso la
    # chiave non e' valida, nel secondo e' valida ma non ha i permessi. Dare lo
    # stesso messaggio manda l'utente a rigenerare una chiave che funziona.
    if resp.status_code == 401:
        raise SumUpError(
            "SumUp non riconosce la chiave API (401). Controlla di aver "
            "incollato una secret key che inizia con sup_sk_, senza spazi "
            "iniziali o finali, e che non sia stata revocata. "
            "Risposta di SumUp: " + resp.text[:200]
        )
    if resp.status_code == 403:
        raise SumUpError(
            "La chiave API e' valida ma non ha i permessi per questa "
            "operazione (403). Rigenerala dal dashboard SumUp includendo gli "
            "scope di lettura su profilo, transazioni, payouts e ricevute. "
            "Risposta di SumUp: " + resp.text[:200]
        )
    if resp.status_code >= 400:
        raise SumUpError("SumUp ha risposto %d: %s" % (resp.status_code, resp.text[:200]))


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
        # Id tecnico, necessario per richiedere la ricevuta: e' diverso dal
        # transaction_code usato come chiave di riconciliazione.
        "provider_id": str(item.get("id") or "") or None,
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


# ── Ricevute ──────────────────────────────────────────────────────────────────

async def get_receipt(api_key: str, merchant_code: str, transaction_id: str) -> dict:
    """Dettaglio completo della ricevuta: righe prodotto, ripartizione IVA per
    aliquota, dati carta ed eventi (versamento, storno, rimborso) della singola
    transazione.

    Richiede lo scope receipts.read sulla chiave API: se manca, SumUp risponde
    403 pur essendo la chiave valida per il resto.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{_BASE}/v1.1/receipts/{transaction_id}",
            headers=_headers(api_key),
            params={"mid": merchant_code},
        )
    if resp.status_code == 404:
        raise SumUpError("Ricevuta non trovata per questa transazione.")
    if resp.status_code == 403:
        raise SumUpError(
            "SumUp nega l'accesso alle ricevute: la chiave API non ha lo scope "
            "receipts.read. Rigenerala dal dashboard includendo quel permesso."
        )
    _raise_for(resp)
    return resp.json()


def normalize_receipt(raw: dict) -> dict:
    """Estrae dal payload SumUp i dati che servono in contabilita', appiattendo
    la struttura annidata."""
    tx = raw.get("transaction_data") or {}
    merchant = (raw.get("merchant_data") or {}).get("merchant_profile") or {}
    card = tx.get("card") or {}
    acquirer = raw.get("acquirer_data") or {}

    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    return {
        "numero_ricevuta": tx.get("receipt_no"),
        "transaction_code": tx.get("transaction_code"),
        "data": tx.get("timestamp"),
        "stato": tx.get("status"),
        "importo": _f(tx.get("amount")),
        "iva_totale": _f(tx.get("vat_amount")),
        "mancia": _f(tx.get("tip_amount")),
        "valuta": tx.get("currency"),
        "tipo_pagamento": tx.get("payment_type"),
        "modalita_inserimento": tx.get("entry_mode"),
        "verifica": tx.get("verification_method"),
        "carta_tipo": card.get("type"),
        "carta_ultime4": card.get("last_4_digits"),
        "codice_autorizzazione": acquirer.get("authorization_code"),
        "esercente": merchant.get("business_name"),
        "partita_iva": merchant.get("vat_id"),
        "prodotti": [
            {
                "nome": p.get("name"),
                "descrizione": p.get("description"),
                "prezzo": _f(p.get("price")),
                "quantita": p.get("quantity"),
                "aliquota": _f(p.get("vat_rate")),
                "iva": _f(p.get("vat_amount")),
                "totale": _f(p.get("total_price")),
            }
            for p in (tx.get("products") or [])
        ],
        "iva_per_aliquota": [
            {
                "aliquota": _f(v.get("rate")),
                "imponibile": _f(v.get("net")),
                "iva": _f(v.get("vat")),
                "lordo": _f(v.get("gross")),
            }
            for v in (tx.get("vat_rates") or [])
        ],
        # Dice se questo singolo incasso e' gia' stato versato, stornato o
        # rimborsato: e' il dato che collega la vendita al bonifico.
        "eventi": [
            {
                "tipo": e.get("type"),
                "stato": e.get("status"),
                "importo": _f(e.get("amount")),
                "data": e.get("timestamp"),
            }
            for e in (tx.get("events") or [])
        ],
    }
