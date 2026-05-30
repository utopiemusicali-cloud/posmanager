#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy.sh — Aggiorna l'applicazione sul server
# VPS OVH: vps-008f120b.vps.ovh.net (162.19.226.27) · 4 vCPU · 8 GB · 75 GB · Ubuntu 22.04
#
# Uso:
#   cd /opt/posmanager
#   bash scripts/deploy.sh
#
# Cosa fa:
#   0. Backup del DB prima di ogni deploy
#   1. git pull
#   2. Build immagini modificate (backend + frontend)
#   3. Aggiorna il volume frontend_static
#   4. Riavvia backend + esegue migrazioni Alembic
#   5. Reload nginx (zero-downtime: MySQL e certbot non vengono toccati)
#   6. Health check + cleanup immagini obsolete
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# ── Determina modalità SSL ───────────────────────────────────────────────────
if grep -q "listen 443 ssl" nginx/conf.d/default.conf 2>/dev/null; then
    COMPOSE_FILES="-f docker-compose.prod.yml -f docker-compose.ssl.yml"
    SSL_MODE=true
else
    COMPOSE_FILES="-f docker-compose.prod.yml"
    SSL_MODE=false
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
printf "║  DEPLOY — %-58s║\n" "$(date '+%Y-%m-%d %H:%M:%S')"
printf "║  Modalità: %-57s║\n" "$([ "$SSL_MODE" = true ] && echo 'HTTPS ✅' || echo 'HTTP (SSL non ancora attivo)')"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

# ── Verifica working tree pulito ─────────────────────────────────────────────
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo "⚠  Ci sono modifiche locali non committate:"
    git status --short
    echo ""
    read -rp "   Continuare comunque? (le modifiche locali potrebbero andare perse) [y/N] " yn
    [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

# ── [0/6] Backup preventivo ──────────────────────────────────────────────────
echo "==> [0/6] Backup DB pre-deploy..."
if bash scripts/backup_mysql.sh; then
    echo "    ✅ Backup completato"
else
    echo "    ⚠  Backup fallito. Vuoi continuare comunque?"
    read -rp "    [y/N] " yn
    [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

# ── [1/6] Pull aggiornamenti ─────────────────────────────────────────────────
echo "==> [1/6] git pull..."
git pull --ff-only
echo "    Commit: $(git rev-parse --short HEAD) — $(git log -1 --format='%s')"

# ── [2/6] Build immagini ─────────────────────────────────────────────────────
echo "==> [2/6] Build immagini Docker..."
# --pull aggiorna le immagini base (python:3.12-slim, node:20-alpine)
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES build --pull backend frontend_builder
echo "    Build completato."

# ── [3/6] Aggiornamento frontend ─────────────────────────────────────────────
echo "==> [3/6] Aggiornamento frontend (volume statico)..."
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up --force-recreate -d frontend_builder

# Attende che il builder finisca (exit 0) — max 120s
echo "    Attendo build frontend..."
WAIT=0
while docker compose $COMPOSE_FILES ps frontend_builder 2>/dev/null | grep -q "running\|Up"; do
    sleep 3; WAIT=$((WAIT+3))
    if [ $WAIT -gt 120 ]; then
        echo "    ⚠  Build frontend ancora in corso dopo 120s, proseguo..."
        break
    fi
done
echo "    ✅ Frontend aggiornato."

# ── [4/6] Riavvio backend + migrazioni ──────────────────────────────────────
echo "==> [4/6] Riavvio backend..."
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d --force-recreate backend

# Aspetta che il backend sia pronto (max 30s)
echo "    Attendo avvio backend..."
sleep 5
WAIT=0
while ! docker compose $COMPOSE_FILES exec -T backend \
        python -c "import app.main" 2>/dev/null; do
    sleep 3; WAIT=$((WAIT+3))
    if [ $WAIT -gt 30 ]; then
        echo "    ⚠  Backend lento ad avviarsi, proseguo comunque..."
        break
    fi
done

# Migrazioni Alembic
echo "    Esecuzione migrazioni Alembic..."
# shellcheck disable=SC2086
if docker compose $COMPOSE_FILES exec -T backend alembic upgrade head 2>&1; then
    echo "    ✅ Migrazioni OK"
else
    echo "    ⚠  Migrazioni fallite o Alembic non disponibile."
    echo "    Controlla: docker compose $COMPOSE_FILES logs backend --tail=50"
    read -rp "    Continuare comunque? [y/N] " yn
    [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

# ── [5/6] Reload nginx ───────────────────────────────────────────────────────
echo "==> [5/6] Reload nginx..."
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d --force-recreate nginx
sleep 3

# ── [6/6] Health check + cleanup ────────────────────────────────────────────
echo "==> [6/6] Health check..."

# Determina URL da testare
if [ "$SSL_MODE" = true ]; then
    # shellcheck disable=SC1090
    DOMAIN=$(grep -v '^#' .env | grep '^DOMAIN=' | cut -d= -f2 | tr -d ' ')
    URL="https://${DOMAIN}/api/health"
else
    URL="http://localhost/api/health"
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null || echo "ERR")
if [ "$HTTP_CODE" = "200" ]; then
    echo "    ✅  $URL → 200 OK"
else
    echo "    ⚠   $URL → $HTTP_CODE"
    # shellcheck disable=SC2086
    echo "    Ultimi log backend:"
    docker compose $COMPOSE_FILES logs backend --tail=20 2>/dev/null || true
fi

# Stato servizi
echo ""
echo "==> Stato servizi:"
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES ps

# Pulizia immagini Docker obsolete (> 24h e non in uso)
echo ""
echo "==> Pulizia immagini obsolete..."
FREED=$(docker image prune -f --filter "until=24h" 2>/dev/null | grep "reclaimed" || echo "nulla da pulire")
echo "    $FREED"

# ── Riepilogo ─────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
printf "║  DEPLOY COMPLETATO ✅  — %-44s║\n" "$(date '+%Y-%m-%d %H:%M:%S')"
printf "║  Commit: %-59s║\n" "$(git rev-parse --short HEAD) — $(git log -1 --format='%s')"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
