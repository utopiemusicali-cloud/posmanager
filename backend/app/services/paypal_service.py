"""Client PayPal per l'importazione delle transazioni (sola lettura).

Usa la Transaction Search API, che richiede due cose spesso dimenticate:
  1. l'app PayPal deve avere abilitata la voce "Transaction Search" nel
     developer dashboard, altrimenti l'API risponde 403 anche con credenziali
     valide;
  2. ogni richiesta copre al massimo 31 giorni, quindi un periodo piu' lungo
     va spezzato in finestre (ci pensa fetch_transactions).

Nessuna funzione qui muove denaro: si leggono soltanto i movimenti per la
riconciliazione con cassa e ricevute.
"""
from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import httpx

_LIVE = "https://api-m.paypal.com"
_SANDBOX = "https://api-m.sandbox.paypal.com"

_MAX_WINDOW_DAYS = 31   # limite imposto da PayPal per singola richiesta
_PAGE_SIZE = 500        # massimo consentito

# PayPal codifica lo stato con una lettera sola
_STATUS = {
    "S": "Completata",
    "P": "In sospeso",
    "V": "Stornata",
    "D": "Negata",
    "F": "Rimborso parziale",
}


def base_url(sandbox: bool) -> str:
    return _SANDBOX if sandbox else _LIVE


class PayPalError(RuntimeError):
    """Errore parlante, pensato per essere mostrato all'utente."""


async def get_access_token(client_id: str, client_secret: str, sandbox: bool) -> str:
    """OAuth2 client_credentials. Le credenziali viaggiano in Basic auth e non
    vengono mai loggate."""
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base_url(sandbox)}/v1/oauth2/token",
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            content="grant_type=client_credentials",
        )
    if resp.status_code == 401:
        raise PayPalError(
            "Credenziali PayPal rifiutate. Verifica Client ID e Secret, e che "
            "corrispondano all'ambiente selezionato (sandbox o produzione)."
        )
    if resp.status_code >= 400:
        raise PayPalError(f"PayPal ha risposto {resp.status_code} alla richiesta di token.")
    token = resp.json().get("access_token")
    if not token:
        raise PayPalError("PayPal non ha restituito un access token.")
    return token


def _windows(start: datetime, end: datetime):
    """Spezza il periodo in finestre da 31 giorni."""
    cur = start
    while cur < end:
        chunk_end = min(cur + timedelta(days=_MAX_WINDOW_DAYS), end)
        yield cur, chunk_end
        cur = chunk_end


def _fmt(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S%z")


def _amount(raw: dict | None) -> Decimal | None:
    if not raw or raw.get("value") in (None, ""):
        return None
    try:
        return Decimal(str(raw["value"]))
    except (InvalidOperation, TypeError, ValueError):
        return None


def to_transaction(detail: dict) -> dict | None:
    """Riduce una transazione PayPal ai campi di digital_transactions.
    None se manca l'identificativo, senza il quale non e' deduplicabile."""
    info = detail.get("transaction_info") or {}
    payer = detail.get("payer_info") or {}

    tx_id = info.get("transaction_id")
    if not tx_id:
        return None

    raw_date = info.get("transaction_initiation_date") or info.get("transaction_updated_date") or ""
    try:
        dt = datetime.strptime(raw_date, "%Y-%m-%dT%H:%M:%S%z")
    except (ValueError, TypeError):
        return None

    amount = info.get("transaction_amount") or {}
    descrizione = (
        info.get("transaction_subject")
        or info.get("transaction_note")
        or (payer.get("payer_name") or {}).get("alternate_full_name")
        or ""
    )

    return {
        "fonte": "PayPal",
        "transaction_id": tx_id,
        "data": dt.replace(tzinfo=None),
        "ora": dt.strftime("%H:%M:%S"),
        "importo": _amount(amount),
        "valuta": amount.get("currency_code"),
        "stato": _STATUS.get(info.get("transaction_status", ""), info.get("transaction_status")),
        "tipo": info.get("transaction_event_code"),
        "email": payer.get("email_address"),
        "descrizione": descrizione[:2000] if descrizione else None,
    }


async def fetch_transactions(
    client_id: str, client_secret: str, sandbox: bool,
    start: datetime, end: datetime,
) -> list[dict]:
    """Tutte le transazioni del periodo, gia' normalizzate."""
    token = await get_access_token(client_id, client_secret, sandbox)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    out: list[dict] = []

    async with httpx.AsyncClient(headers=headers, timeout=60) as client:
        for win_start, win_end in _windows(start, end):
            page = 1
            while True:
                resp = await client.get(
                    f"{base_url(sandbox)}/v1/reporting/transactions",
                    params={
                        "start_date": _fmt(win_start),
                        "end_date": _fmt(win_end),
                        "fields": "transaction_info,payer_info",
                        "page_size": _PAGE_SIZE,
                        "page": page,
                    },
                )
                if resp.status_code == 403:
                    raise PayPalError(
                        "PayPal nega l'accesso alla Transaction Search API. Abilita "
                        "\"Transaction Search\" tra le funzionalita' dell'app nel "
                        "developer dashboard di PayPal."
                    )
                if resp.status_code >= 400:
                    raise PayPalError(
                        f"PayPal ha risposto {resp.status_code} durante la lettura "
                        f"delle transazioni: {resp.text[:200]}"
                    )

                data = resp.json()
                for detail in data.get("transaction_details", []):
                    tx = to_transaction(detail)
                    if tx:
                        out.append(tx)

                if page >= int(data.get("total_pages") or 1):
                    break
                page += 1

    return out
