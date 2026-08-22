"""Importazione dell'estratto conto SumUp (file scaricato dal dashboard).

Il formato ha due caratteristiche che guidano il parsing:

1. Entrate e uscite stanno in COLONNE SEPARATE, non in un unico importo con
   segno. Qui vengono riunite in un solo valore con segno, perche' e' quello
   su cui si fanno somme e filtri.
2. Esistono due coppie di importi: "fatturazione" (valuta del conto, cio' che
   ha mosso il saldo) e "transazione" (valuta originale). Per la contabilita'
   vale la prima; la seconda si conserva per spiegare le differenze di cambio.

L'import e' idempotente sul "Codice transazione": reimportare lo stesso file,
o un file che si sovrappone al precedente, aggiorna invece di duplicare.
"""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation

# Intestazioni attese, normalizzate. Si accettano varianti perche' l'export
# puo' cambiare maiuscole o spaziatura fra una versione e l'altra.
COL = {
    "data": ["data transazione", "data"],
    "codice": ["codice transazione", "codice"],
    "tipo": ["tipo transazione", "tipo"],
    "riferimento": ["riferimento"],
    "causale": ["causale pagamento", "causale"],
    "stato": ["stato"],
    "out_fatt": ["importo di fatturazione in uscita"],
    "in_fatt": ["importo di fatturazione in entrata"],
    "valuta_carta": ["valuta della carta"],
    "out_tx": ["importo transazione in uscita"],
    "in_tx": ["importo transazione in entrata"],
    "valuta_tx": ["valuta della transazione"],
    "cambio": ["tasso di cambio"],
    "commissione": ["commissione"],
    "saldo": ["saldo disponibile"],
}

_DATE_FORMATS = [
    "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y",
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d",
    "%d-%m-%Y %H:%M:%S", "%d-%m-%Y",
]


class BankImportError(RuntimeError):
    """Errore parlante, pensato per essere mostrato all'utente."""


def _norm_header(h):
    return (h or "").strip().lstrip("\ufeff").lower().replace("  ", " ")


def _build_index(headers):
    """Mappa nome logico -> indice di colonna."""
    normalized = [_norm_header(h) for h in headers]
    index = {}
    for key, aliases in COL.items():
        for alias in aliases:
            if alias in normalized:
                index[key] = normalized.index(alias)
                break
    return index


def _dec(raw):
    """Converte un importo tollerando sia il formato italiano (1.234,56) sia
    quello inglese (1234.56), oltre a spazi unificatori e simboli di valuta."""
    if raw is None:
        return None
    s = str(raw).strip().replace("\u00a0", "").replace(" ", "")
    for symbol in ("\u20ac", "EUR", "$", "\u00a3"):
        s = s.replace(symbol, "")
    if not s or s in ("-", "--"):
        return None

    if "," in s and "." in s:
        # L'ultimo separatore che compare e' quello decimale.
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")

    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _parse_date(raw):
    s = (raw or "").strip()
    if not s:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _sniff_dialect(sample):
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        return csv.excel


def parse_statement(content):
    """Restituisce (movimenti, avvisi). Le righe illeggibili non fanno fallire
    l'import: vengono contate e segnalate, perche' un estratto conto con una
    riga anomala e' comunque piu' utile di nessun estratto conto."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("latin-1")
        except UnicodeDecodeError as e:
            raise BankImportError("Impossibile leggere il file: %s" % e)

    reader = csv.reader(io.StringIO(text), _sniff_dialect(text[:4096]))
    try:
        headers = next(reader)
    except StopIteration:
        raise BankImportError("Il file e' vuoto.")

    idx = _build_index(headers)
    mancanti = [k for k in ("data", "codice") if k not in idx]
    if mancanti:
        raise BankImportError(
            "Il file non sembra un estratto conto SumUp: mancano le colonne "
            "'Data transazione' e/o 'Codice transazione'. Intestazioni "
            "trovate: " + ", ".join(headers[:8])
        )

    def cell(row, key):
        i = idx.get(key)
        return row[i] if i is not None and i < len(row) else None

    movimenti = []
    avvisi = []
    scartate = 0

    for n, row in enumerate(reader, start=2):
        if not any((c or "").strip() for c in row):
            continue

        data = _parse_date(cell(row, "data"))
        if data is None:
            scartate += 1
            if len(avvisi) < 5:
                avvisi.append("Riga %d: data non riconosciuta (%r)" % (n, cell(row, "data")))
            continue

        codice = (cell(row, "codice") or "").strip()
        if not codice:
            # Senza identificativo si ricade su un'impronta della riga: meno
            # solido, ma preferibile a scartare il movimento.
            impronta = "|".join(str(c) for c in row)
            codice = "H" + hashlib.sha1(impronta.encode()).hexdigest()[:24]

        entrata = _dec(cell(row, "in_fatt")) or Decimal(0)
        uscita = _dec(cell(row, "out_fatt")) or Decimal(0)
        # Le colonne separate diventano un unico importo con segno. L'uscita
        # puo' gia' arrivare negativa: si usa il valore assoluto per non
        # trasformarla in un accredito.
        importo = entrata - abs(uscita)

        entrata_tx = _dec(cell(row, "in_tx")) or Decimal(0)
        uscita_tx = _dec(cell(row, "out_tx")) or Decimal(0)
        importo_tx = entrata_tx - abs(uscita_tx)

        movimenti.append({
            "codice_transazione": codice[:128],
            "data": data,
            "tipo": ((cell(row, "tipo") or "").strip()[:128]) or None,
            "riferimento": (cell(row, "riferimento") or "").strip() or None,
            "causale": (cell(row, "causale") or "").strip() or None,
            "stato": ((cell(row, "stato") or "").strip()[:64]) or None,
            "importo": importo,
            "valuta": ((cell(row, "valuta_carta") or "").strip()[:8]) or None,
            "importo_valuta_originale": importo_tx or None,
            "valuta_originale": ((cell(row, "valuta_tx") or "").strip()[:8]) or None,
            "tasso_cambio": _dec(cell(row, "cambio")),
            "commissione": _dec(cell(row, "commissione")),
            "saldo_disponibile": _dec(cell(row, "saldo")),
        })

    if scartate:
        avvisi.append("%d righe scartate perche' prive di una data valida." % scartate)
    if not movimenti:
        raise BankImportError(
            "Nessun movimento leggibile nel file. Controlla di aver esportato "
            "l'estratto conto e non un altro report."
        )
    return movimenti, avvisi
