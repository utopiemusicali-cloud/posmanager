#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# backup_mysql.sh — Dump applicativo MySQL (complementare ai backup OVH)
# VPS OVH: vps-008f120b.vps.ovh.net (162.19.226.27) · 4 vCPU · 8 GB · 75 GB NVMe
#
# BACKUP STRATEGY su questo VPS:
#   • OVH Automated Backup  → snapshot VM completo, 7 rotazioni (già attivo)
#   • OVH Snapshot manuale  → fotografia on-demand dal pannello OVH Manager
#   • Questo script         → dump SQL compresso, 14 rotazioni, per restore
#                             selettivo di singole tabelle senza toccare la VM
#
# Installazione crontab (come utente posmanager):
#   crontab -e
#   # OVH fa snapshot alle ~03:xx, noi facciamo il dump alle 04:00
#   0 4 * * * /opt/posmanager/scripts/backup_mysql.sh >> /var/log/posmanager-backup.log 2>&1
#
# I dump vengono salvati in /opt/posmanager/backups/
# Vengono mantenuti gli ultimi 14 giorni (su 75 GB è più che sufficiente).
#
# Restore da un dump specifico:
#   zcat backups/posmanager_20250601_040000.sql.gz \
#     | docker compose -f docker-compose.prod.yml exec -T mysql \
#       mysql -u posmanager -p"${MYSQL_PASSWORD}" posmanager
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

TS="[$(date '+%Y-%m-%d %H:%M:%S')]"

# ── Carica .env ───────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    echo "$TS ❌ ERRORE: .env non trovato in $APP_DIR"
    exit 1
fi
# shellcheck disable=SC2046
export $(grep -v '^#' .env | grep -v '^$' | xargs)

: "${MYSQL_ROOT_PASSWORD:?Variabile MYSQL_ROOT_PASSWORD mancante nel .env}"
: "${MYSQL_DATABASE:?Variabile MYSQL_DATABASE mancante nel .env}"

# ── Configurazione ────────────────────────────────────────────────────────────
BACKUP_DIR="$APP_DIR/backups"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/${MYSQL_DATABASE}_${TIMESTAMP}.sql.gz"
KEEP_DAYS=14        # 14 dump × ~5 MB ciascuno ≈ 70 MB — trascurabile su 75 GB
DISK_MIN_GB=5       # interrompe se meno di 5 GB liberi

mkdir -p "$BACKUP_DIR"

# ── Controllo spazio disco ───────────────────────────────────────────────────
DISK_FREE_GB=$(df -BG "$BACKUP_DIR" | awk 'NR==2 {gsub("G",""); print $4}')
if [ "$DISK_FREE_GB" -lt "$DISK_MIN_GB" ]; then
    echo "$TS ❌ Spazio disco insufficiente: ${DISK_FREE_GB}G liberi (minimo ${DISK_MIN_GB}G)"
    echo "$TS    Controlla: df -h && du -sh $BACKUP_DIR/*"
    exit 1
fi
echo "$TS Spazio disco disponibile: ${DISK_FREE_GB}G ✅"

# ── Verifica che MySQL sia in esecuzione ─────────────────────────────────────
if ! docker compose -f docker-compose.prod.yml ps mysql 2>/dev/null | grep -qE "running|Up|healthy"; then
    echo "$TS ❌ MySQL non è in esecuzione. Avvio in corso..."
    exit 1
fi

# ── Dump ─────────────────────────────────────────────────────────────────────
echo "$TS Avvio dump → $BACKUP_FILE"

docker compose -f docker-compose.prod.yml exec -T mysql \
    mysqldump \
    --user=root \
    --password="$MYSQL_ROOT_PASSWORD" \
    --single-transaction \
    --quick \
    --routines \
    --triggers \
    --add-drop-table \
    --set-charset \
    "$MYSQL_DATABASE" \
    | gzip -6 > "$BACKUP_FILE"
# Nota: gzip -6 invece di -9 → 3x più veloce, file appena più grande

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "$TS Dump completato: $SIZE"

# ── Verifica integrità ────────────────────────────────────────────────────────
if gzip -t "$BACKUP_FILE" 2>/dev/null; then
    echo "$TS Integrità gz: ✅ OK"
else
    echo "$TS ❌ File gz corrotto! Rimozione..."
    rm -f "$BACKUP_FILE"
    exit 1
fi

# ── Conta righe nel dump (sanity check) ─────────────────────────────────────
ROW_COUNT=$(zcat "$BACKUP_FILE" | grep -c "^INSERT INTO" 2>/dev/null || echo "0")
echo "$TS Statement INSERT nel dump: $ROW_COUNT"
if [ "$ROW_COUNT" -eq 0 ]; then
    echo "$TS ⚠  Attenzione: nessun INSERT trovato nel dump. DB vuoto o errore?"
fi

# ── Rotazione backup vecchi ──────────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
    echo "$TS Rimossi $DELETED dump più vecchi di $KEEP_DAYS giorni"
fi

# ── Elenco backup (ultimi 5) ─────────────────────────────────────────────────
echo "$TS Backup disponibili:"
ls -lhtr "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -5 \
    | awk '{printf "           %s  %s  %s\n", $5, $6" "$7" "$8, $9}' || true

echo "$TS ✅ Backup completato."
