#!/usr/bin/env python3
"""
Script one-shot: migra tutti i dati da SQLite (GP V3) a MySQL (posmanager).

Uso:
    python migrate_sqlite_to_mysql.py \
        --sqlite "G:/Il mio Drive/PointOfSale/TEST/GP V3/database/posmanager.db" \
        --mysql  "mysql+pymysql://posmanager:posmanager_secret@localhost:3306/posmanager"

Prerequisiti:
    pip install pymysql

Eseguire UNA SOLA VOLTA prima del primo deploy.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime


def _parse_ts(v: str | None) -> str | None:
    """Converte vari formati di timestamp in 'YYYY-MM-DD HH:MM:SS'."""
    if not v:
        return None
    for fmt in (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(str(v).strip(), fmt).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    return str(v)[:19] or None


def migrate(sqlite_path: str, mysql_url: str) -> None:
    import pymysql
    from urllib.parse import urlparse

    parsed = urlparse(mysql_url.replace("mysql+pymysql://", "mysql://"))
    my = pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip("/"),
        charset="utf8mb4",
    )
    sq = sqlite3.connect(sqlite_path)
    sq.row_factory = sqlite3.Row

    BATCH = 500

    def migrate_table(table: str, columns: list[str], ts_cols: set[str], extra_transform=None):
        cur_sq = sq.execute(f"SELECT * FROM {table}")
        cur_my = my.cursor()
        placeholders = ", ".join(["%s"] * len(columns))
        col_list = ", ".join(f"`{c}`" for c in columns)
        sql = f"INSERT IGNORE INTO `{table}` ({col_list}) VALUES ({placeholders})"
        batch = []
        count = 0
        for row in cur_sq:
            vals = []
            for c in columns:
                v = row[c] if c in row.keys() else None
                if c in ts_cols:
                    v = _parse_ts(v)
                vals.append(v)
            if extra_transform:
                vals = extra_transform(vals, columns, row)
            batch.append(tuple(vals))
            if len(batch) >= BATCH:
                cur_my.executemany(sql, batch)
                my.commit()
                count += len(batch)
                batch = []
        if batch:
            cur_my.executemany(sql, batch)
            my.commit()
            count += len(batch)
        print(f"  {table}: {count} righe migrati")

    print("→ customers")
    migrate_table(
        "customers",
        ["id", "nome", "tel", "mail", "instagram", "note", "created_at", "updated_at"],
        {"created_at", "updated_at"},
    )

    print("→ shop_receipts")
    migrate_table(
        "shop_receipts",
        ["id", "receipt_ts", "numero_ricevuta", "discount", "bonus", "total_paid",
         "cliente", "items", "d_items", "metodo_pagamento", "file_origine",
         "customer_id", "created_at"],
        {"receipt_ts", "created_at"},
    )

    print("→ cash_movements")
    migrate_table(
        "cash_movements",
        ["id", "movement_ts", "utente", "nota", "importo", "fornitore",
         "tipo_spesa", "metodo_pagamento", "ricevuta", "numero_ricevuta",
         "saldo", "created_at", "updated_at"],
        {"movement_ts", "created_at", "updated_at"},
    )

    print("→ expenses")
    migrate_table(
        "expenses",
        ["id", "data", "importo", "nota", "fornitore", "ricevuta",
         "numero_ricevuta", "metodo_pagamento", "tipo_spesa", "utente",
         "created_at", "updated_at"],
        {"data", "created_at", "updated_at"},
    )

    print("→ sessions")
    migrate_table(
        "sessions",
        ["id", "data_apertura", "utente", "saldo_effettivo_apertura",
         "saldo_contabile_apertura", "data_chiusura", "saldo_effettivo_chiusura",
         "saldo_contabile_chiusura", "differenza", "note", "created_at"],
        {"data_apertura", "data_chiusura", "created_at"},
    )

    print("→ daily_closures")
    migrate_table(
        "daily_closures",
        ["id", "closure_ts", "saldo_contabile", "effettivo_cassa", "differenza",
         "utente", "note", "tipo", "created_at"],
        {"closure_ts", "created_at"},
    )

    print("→ digital_transactions")
    migrate_table(
        "digital_transactions",
        ["id", "fonte", "data", "ora", "transaction_id", "importo", "valuta",
         "stato", "tipo", "carta", "email", "descrizione", "created_at"],
        {"data", "created_at"},
    )

    print("→ deletions_log")
    migrate_table(
        "deletions_log",
        ["id", "deleted_at", "utente_eliminazione", "tipo_operazione",
         "data_operazione", "utente_operazione", "nota", "importo", "saldo",
         "tipo_spesa", "fornitore"],
        {"deleted_at"},
    )

    print("→ cost_centers")
    migrate_table(
        "cost_centers",
        ["id", "data", "categoria", "importo", "nota", "utente", "created_at"],
        {"data", "created_at"},
    )

    sq.close()
    my.close()
    print("\n✓ Migrazione completata.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migra dati da SQLite a MySQL")
    parser.add_argument("--sqlite", required=True, help="Percorso file .db SQLite")
    parser.add_argument("--mysql", required=True, help="URL MySQL (mysql+pymysql://...)")
    args = parser.parse_args()
    migrate(args.sqlite, args.mysql)
