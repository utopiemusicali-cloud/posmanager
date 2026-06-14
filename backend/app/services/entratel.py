"""
Generatore file corrispettivi AdE — Provvedimento 12/03/2009 prot. 21544/09.
Formato: record a larghezza fissa 1800 caratteri, encoding latin-1.

Struttura record:
  "0" — testata file (1 per file)
  "1" — identificazione punto vendita (1 per negozio)
  "2" — corrispettivi giornalieri per aliquota IVA (N record da 75 blocchi ciascuno)
  "9" — coda file (uguale a testata ma tipo "9")

Blocco Record 2 (23 byte):
  GGMMAAAA (8)  |  aliquota (2)  |  importo_euro (13, zero-padded, nessun decimale)

Codici aliquota IVA:
  AS = Assenza corrispettivi (giorno senza vendite)
  NI = Non Imponibile
  ES = Esente
  RP = Regime Particolari (include regime del margine D.L. 41/95)
  04 = 4%
  10 = 10%
  22 = 22%  (era "20" nella spec originale 2009 — aliquota variata nel 2011)

NOTA: Questo formato è previsto per imprese di Grande Distribuzione (art. 1 co. 430
L. 311/2004). Per PMI il canale ufficiale è il Registratore Telematico (D.Lgs 127/2015).
Verificare l'applicabilità con il proprio commercialista prima dell'invio via Entratel.
"""
from __future__ import annotations

import calendar
import logging
from datetime import date
from typing import NamedTuple

logger = logging.getLogger(__name__)

RECORD_LEN = 1800
BLOCKS_PER_REC2 = 75
BLOCK_LEN = 23   # 8 (data) + 2 (aliquota) + 13 (importo)


# Mappa da aliquota interna → codice AdE
ALIQUOTA_TO_ADE: dict[str, str] = {
    "22": "22",
    "10": "10",
    "04": "04",
    "4": "04",
    "NI": "NI",
    "ES": "ES",
    "Margine": "RP",
    "RP": "RP",
}


class ShopInfo(NamedTuple):
    ragione_sociale: str
    codice_fiscale: str   # 16 chars, alfanumerico
    numero_rea: str       # es. "MI-1234567"
    indirizzo: str
    comune: str
    provincia: str        # 2 chars sigla


def _r(s: str, n: int) -> str:
    """Pad right con spazi, tronca se troppo lungo."""
    return str(s or "")[:n].ljust(n)


def _l(s: str, n: int, fill: str = "0") -> str:
    """Pad left con fill char (default '0')."""
    return str(s or "")[:n].rjust(n, fill)


def _rec0(cf: str, anno: int, primo: date, ultimo: date) -> str:
    rec = (
        "0"
        + _r(cf, 16)                          # CF soggetto trasmittente
        + str(anno)                           # anno imposta (4)
        + primo.strftime("%d%m%Y")            # data inizio periodo (8)
        + ultimo.strftime("%d%m%Y")           # data fine periodo (8)
        + "0001"                              # n. punti vendita (4) — 1 negozio
    )
    return rec.ljust(RECORD_LEN)


def _rec1(shop: ShopInfo) -> str:
    rec = (
        "1"
        + _r(shop.numero_rea, 20)   # numero REA
        + _r(shop.indirizzo, 50)    # indirizzo
        + _r(shop.comune, 30)       # comune
        + _r(shop.provincia, 2)     # provincia (sigla)
        + "0"                       # flag ventilazione (0 = non ventilazione)
        + "0"                       # flag chiuso (0 = aperto)
    )
    return rec.ljust(RECORD_LEN)


def _build_blocks(
    anno: int,
    mese: int,
    daily: dict[date, dict[str, float]],
) -> list[str]:
    """
    Ritorna lista di blocchi da 23 char ciascuno.
    daily: {data: {"RP": 150.0, "22": 30.0, ...}}
    Giorni senza vendite → blocco con aliquota "AS", importo 0.
    """
    blocks: list[str] = []
    n_giorni = calendar.monthrange(anno, mese)[1]
    for g in range(1, n_giorni + 1):
        d = date(anno, mese, g)
        day_data = daily.get(d)
        if not day_data:
            blocks.append(d.strftime("%d%m%Y") + "AS" + "0" * 13)
        else:
            for aliquota, importo in day_data.items():
                ade_code = ALIQUOTA_TO_ADE.get(aliquota, "RP")
                # abs(): importi negativi (rimborsi) non sono rappresentabili
                # nel formato AdE (solo cifre). Si usa il valore assoluto.
                euro_int = abs(round(float(importo)))
                blocks.append(
                    d.strftime("%d%m%Y")
                    + _r(ade_code, 2)
                    + _l(str(euro_int), 13)
                )
    return blocks


def _rec2_records(blocks: list[str]) -> list[str]:
    """Divide i blocchi in record da BLOCKS_PER_REC2 (75) ciascuno."""
    records: list[str] = []
    for i in range(0, max(len(blocks), 1), BLOCKS_PER_REC2):
        group = blocks[i : i + BLOCKS_PER_REC2]
        # Padding blocchi vuoti con spazi
        padding = " " * (BLOCKS_PER_REC2 - len(group)) * BLOCK_LEN
        rec = "2" + "".join(group) + padding
        records.append(rec.ljust(RECORD_LEN))
    return records


def generate(
    shop: ShopInfo,
    anno: int,
    mese: int,
    daily: dict[date, dict[str, float]],
) -> bytes:
    """
    Genera il file corrispettivi in formato Entratel AdE.

    Parametri:
      shop  — dati anagrafici del punto vendita
      anno  — anno d'imposta (es. 2024)
      mese  — mese (1-12)
      daily — dizionario {data: {codice_aliquota: importo_euro}}
               es. {date(2024,6,14): {"RP": 150.0}}

    Ritorna i byte del file (encoding latin-1, CRLF line endings).
    """
    primo = date(anno, mese, 1)
    ultimo = date(anno, mese, calendar.monthrange(anno, mese)[1])

    head = _rec0(shop.codice_fiscale, anno, primo, ultimo)
    rec1 = _rec1(shop)
    blocks = _build_blocks(anno, mese, daily)
    data_recs = _rec2_records(blocks)
    tail = "9" + head[1:]  # coda = testata con tipo "9"

    lines = [head, rec1] + data_recs + [tail]
    content = "\r\n".join(lines) + "\r\n"
    return content.encode("latin-1", errors="replace")
