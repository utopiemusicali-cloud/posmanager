#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# init_ssl.sh — Acquisisce il primo certificato Let's Encrypt
# VPS OVH: 4 vCPU · 8 GB · 75 GB · Ubuntu 22.04
#
# Prerequisiti:
#   ✓ docker-compose.prod.yml già in esecuzione (nginx HTTP-only attivo)
#   ✓ Record DNS  A   tuodominio.com     → IP_OVH
#   ✓ Record DNS  A   www.tuodominio.com → IP_OVH   (opzionale, vedi sotto)
#   ✓ File .env con DOMAIN e CERTBOT_EMAIL compilati
#   ✓ Porta 80 aperta nel firewall OVH (verifica nel pannello OVH Manager)
#
# Uso:
#   cd /opt/posmanager
#   bash scripts/init_ssl.sh
#
# Nota sul www: se non hai un record DNS per www.DOMAIN, imposta
# CERTBOT_WWW=false nel .env per saltare il certificato www.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# ── Carica .env ───────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    echo "❌  ERRORE: file .env non trovato in $APP_DIR"
    echo "    Crea il file: cp .env.production.example .env && nano .env"
    exit 1
fi
# shellcheck disable=SC2046
export $(grep -v '^#' .env | grep -v '^$' | xargs)

: "${DOMAIN:?Variabile DOMAIN non impostata nel .env}"
: "${CERTBOT_EMAIL:?Variabile CERTBOT_EMAIL non impostata nel .env}"
CERTBOT_WWW="${CERTBOT_WWW:-true}"   # default: richiede anche www.DOMAIN

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  POSMANAGER — Acquisizione certificato SSL                           ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
printf "║  Dominio:  %-57s║\n" "$DOMAIN"
printf "║  Email:    %-57s║\n" "$CERTBOT_EMAIL"
printf "║  www:      %-57s║\n" "$CERTBOT_WWW"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

# ── [1/5] Verifica DNS ───────────────────────────────────────────────────────
echo "==> [1/5] Verifica risoluzione DNS..."
MY_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || \
        curl -s --max-time 5 https://ifconfig.me 2>/dev/null || echo "sconosciuto")
DNS_IP=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || echo "non_risolto")

echo "    IP di questo server: $MY_IP"
echo "    IP da DNS per $DOMAIN: $DNS_IP"

if [ "$MY_IP" != "$DNS_IP" ]; then
    echo ""
    echo "    ⚠  Il DNS non punta ancora a questo server."
    echo "    Aggiorna il record A nel pannello OVH (o nel provider DNS)"
    echo "    e attendi la propagazione (di solito 5-30 minuti)."
    echo ""
    read -rp "    Continuare comunque? [y/N] " yn
    [[ "$yn" =~ ^[Yy]$ ]] || exit 1
else
    echo "    ✅ DNS OK"
fi

# ── [2/5] Verifica nginx ─────────────────────────────────────────────────────
echo "==> [2/5] Verifica nginx in esecuzione..."
if ! docker compose -f docker-compose.prod.yml ps nginx 2>/dev/null | grep -qE "running|Up"; then
    echo "    nginx non attivo. Avvio..."
    docker compose -f docker-compose.prod.yml up -d nginx
    echo "    Attendo avvio nginx..."
    sleep 10
fi

# Verifica ACME challenge endpoint
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    "http://$DOMAIN/.well-known/acme-challenge/test" 2>/dev/null || echo "ERR")
if [ "$HTTP_CODE" = "404" ]; then
    echo "    ✅ nginx risponde su http://$DOMAIN"
else
    echo "    ⚠  http://$DOMAIN → $HTTP_CODE (atteso 404)"
    echo "    Possibili cause:"
    echo "      - Firewall OVH blocca la porta 80 (controlla il pannello OVH Manager → Network → Firewall)"
    echo "      - nginx non è in esecuzione"
    echo "      - Il DNS non punta a questo server"
    read -rp "    Continuare comunque? [y/N] " yn
    [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

# ── [3/5] Acquisizione certificato ──────────────────────────────────────────
echo "==> [3/5] Acquisizione certificato Let's Encrypt..."

# Costruisce la lista dei domini da certificare
DOMAIN_ARGS="--domains $DOMAIN"
if [ "$CERTBOT_WWW" = "true" ]; then
    DOMAIN_ARGS="$DOMAIN_ARGS --domains www.$DOMAIN"
    echo "    Richiesta per: $DOMAIN + www.$DOMAIN"
else
    echo "    Richiesta per: $DOMAIN (solo apex)"
fi

# shellcheck disable=SC2086
docker compose -f docker-compose.prod.yml run --rm certbot \
    certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$CERTBOT_EMAIL" \
    --agree-tos \
    --no-eff-email \
    $DOMAIN_ARGS

echo "    ✅ Certificato acquisito!"

# ── [4/5] Attiva configurazione HTTPS ───────────────────────────────────────
echo "==> [4/5] Attivazione configurazione HTTPS nginx..."

# Backup della configurazione HTTP attuale
cp nginx/conf.d/default.conf nginx/conf.d/default.http-only.bak
echo "    Backup HTTP config → nginx/conf.d/default.http-only.bak"

# Genera default.conf dal template con il dominio reale
sed "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" \
    nginx/conf.d/default.ssl.conf.template \
    > nginx/conf.d/default.conf

echo "    nginx/conf.d/default.conf aggiornato con dominio: $DOMAIN"

# ── [5/5] Riavvio nginx ──────────────────────────────────────────────────────
echo "==> [5/5] Riavvio nginx con configurazione HTTPS..."
docker compose -f docker-compose.prod.yml -f docker-compose.ssl.yml \
    up -d --force-recreate nginx

echo "    Attendo avvio nginx HTTPS..."
sleep 5

# Test HTTPS
HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    "https://$DOMAIN/api/health" 2>/dev/null || echo "ERR")

echo ""
if [ "$HTTPS_CODE" = "200" ]; then
    echo "    ✅ https://$DOMAIN/api/health → 200 OK"
else
    echo "    ⚠  https://$DOMAIN/api/health → $HTTPS_CODE"
    echo "    Potrebbe essere normale se il backend sta ancora avviando."
    echo "    Controlla: docker compose -f docker-compose.prod.yml logs nginx backend --tail=30"
fi

# ── Riepilogo ─────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  SSL COMPLETATO ✅                                                   ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║                                                                      ║"
printf "║  App:          https://%-46s║\n" "$DOMAIN"
echo "║  Certificato:  /opt/posmanager/nginx/certbot/conf/live/             ║"
echo "║  Scadenza:     ogni 90 giorni (rinnovo auto ogni 12h via certbot)   ║"
echo "║                                                                      ║"
echo "║  Per aggiornare l'app:  bash scripts/deploy.sh                      ║"
echo "║  Per backup manuale:    bash scripts/backup_mysql.sh                ║"
echo "║                                                                      ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
