"""Autenticazione eBay (OAuth 2.0).

eBay ha DUE tipi di token e confonderli e' la causa piu' comune di errori:

- Token APPLICATIVO (grant client_credentials): dimostra solo che l'app
  esiste. Basta per i dati pubblici (ricerca catalogo, tassonomia), NON per
  leggere il proprio inventario o i propri ordini.
- Token UTENTE (grant authorization_code): richiede il consenso del venditore
  via browser e produce un refresh token a lunga durata. E' quello richiesto
  dalle API Sell (Inventory, Fulfillment, Account).

Qui si implementa l'ottenimento di entrambi PARTENDO da credenziali gia'
presenti. Il primo consenso via browser (che produce il refresh token) e' un
passaggio a se', non ancora realizzato: richiede una URL di ritorno pubblica
registrata su eBay come RuName.

NOTA: gli endpoint qui sotto provengono dalla documentazione eBay nota al
momento della scrittura; il sito developer.ebay.com non era raggiungibile per
una verifica diretta. Il primo test con credenziali reali confermera' o
smentira' i percorsi.
"""
from __future__ import annotations

import base64
from urllib.parse import urlencode

import httpx

_PROD = "https://api.ebay.com"
_SANDBOX = "https://api.sandbox.ebay.com"

_PROD_AUTH = "https://auth.ebay.com/oauth2/authorize"
_SANDBOX_AUTH = "https://auth.sandbox.ebay.com/oauth2/authorize"

# Scope minimo per il token applicativo. La stringa contiene sempre
# api.ebay.com anche in sandbox: e' un identificativo, non un indirizzo.
_APP_SCOPE = "https://api.ebay.com/oauth/api_scope"

# Scope necessari per leggere inventario e ordini con il token utente.
SELL_SCOPES = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
    "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
]


class EbayError(RuntimeError):
    """Errore parlante, pensato per essere mostrato all'utente."""


def base_url(sandbox: bool) -> str:
    return _SANDBOX if sandbox else _PROD


def auth_url_base(sandbox: bool) -> str:
    return _SANDBOX_AUTH if sandbox else _PROD_AUTH


def _basic(app_id: str, cert_id: str) -> str:
    raw = f"{(app_id or '').strip()}:{(cert_id or '').strip()}"
    return base64.b64encode(raw.encode()).decode()


def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code == 401:
        raise EbayError(
            "eBay non riconosce le credenziali (401). Controlla App ID e "
            "Cert ID, e che appartengano allo stesso ambiente selezionato "
            "(sandbox o produzione). Risposta: " + resp.text[:200]
        )
    if resp.status_code >= 400:
        raise EbayError(
            "eBay ha risposto %d: %s" % (resp.status_code, resp.text[:300])
        )


async def get_application_token(app_id: str, cert_id: str, sandbox: bool) -> dict:
    """Token applicativo. Serve a verificare che App ID e Cert ID siano
    validi: NON da' accesso a inventario e ordini."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base_url(sandbox)}/identity/v1/oauth2/token",
            headers={
                "Authorization": f"Basic {_basic(app_id, cert_id)}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            content=urlencode({
                "grant_type": "client_credentials",
                "scope": _APP_SCOPE,
            }),
        )
    _raise_for(resp)
    data = resp.json()
    if not data.get("access_token"):
        raise EbayError("eBay non ha restituito un access token.")
    return data


async def get_user_token(app_id: str, cert_id: str, refresh_token: str,
                         sandbox: bool, scopes: list[str] | None = None) -> dict:
    """Access token utente a partire dal refresh token ottenuto col consenso.
    E' questo il token richiesto dalle API Sell."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base_url(sandbox)}/identity/v1/oauth2/token",
            headers={
                "Authorization": f"Basic {_basic(app_id, cert_id)}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            content=urlencode({
                "grant_type": "refresh_token",
                "refresh_token": (refresh_token or "").strip(),
                "scope": " ".join(scopes or SELL_SCOPES),
            }),
        )
    if resp.status_code == 400:
        # Caso frequente e con causa precisa: il refresh token dura circa 18
        # mesi, poi va rifatto il consenso. Vale la pena dirlo invece di
        # lasciare un 400 generico.
        raise EbayError(
            "eBay ha rifiutato il refresh token: potrebbe essere scaduto "
            "(durata circa 18 mesi) o revocato. Va rifatta l'autorizzazione "
            "del venditore. Risposta: " + resp.text[:200]
        )
    _raise_for(resp)
    data = resp.json()
    if not data.get("access_token"):
        raise EbayError("eBay non ha restituito un access token utente.")
    return data


def consent_url(app_id: str, ru_name: str, sandbox: bool,
                scopes: list[str] | None = None) -> str:
    """URL a cui mandare il venditore per autorizzare l'applicazione.
    Al ritorno eBay fornisce un codice da scambiare con il refresh token."""
    return f"{auth_url_base(sandbox)}?" + urlencode({
        "client_id": (app_id or "").strip(),
        "redirect_uri": (ru_name or "").strip(),
        "response_type": "code",
        "scope": " ".join(scopes or SELL_SCOPES),
    })
