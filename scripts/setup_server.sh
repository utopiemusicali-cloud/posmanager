#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# setup_server.sh — Setup one-time VPS OVH
#
# VPS:  vps-008f120b.vps.ovh.net  /  162.19.226.27
# IPv6: 2001:41d0:701:1100::2a34
# HW:   4 vCPU · 8 GB RAM · 75 GB NVMe · Ubuntu 22.04 LTS
#
# Esegui appena ricevi le credenziali OVH:
#   ssh ubuntu@vps-008f120b.vps.ovh.net
#   curl -fsSL https://raw.githubusercontent.com/utopiemusicali-cloud/posmanager/main/scripts/setup_server.sh | sudo bash
#
# Supporta: Ubuntu 22.04 / 24.04 · Debian 11 / 12
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configurazione ────────────────────────────────────────────────────────────
DEPLOY_USER="posmanager"
REPO_URL="https://github.com/utopiemusicali-cloud/posmanager.git"   # ← modifica con il tuo repo
APP_DIR="/opt/posmanager"
SWAP_SIZE="2G"          # swap di sicurezza (utile durante build Docker pesanti)
TIMEZONE="Europe/Rome"

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  POSMANAGER — Setup VPS OVH (4 vCPU / 8 GB / 75 GB · Ubuntu 22.04) ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""

# ── Rileva OS (Ubuntu o Debian) ───────────────────────────────────────────────
OS_ID=$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
OS_VERSION=$(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
OS_CODENAME=$(lsb_release -cs 2>/dev/null || grep 'VERSION_CODENAME' /etc/os-release | cut -d= -f2)

echo "    OS rilevato: $OS_ID $OS_VERSION ($OS_CODENAME)"

case "$OS_ID" in
    ubuntu|debian) ;;
    *)
        echo "⚠  OS non supportato: $OS_ID. Supportati: ubuntu, debian."
        read -rp "   Continuare comunque? [y/N] " yn
        [[ "$yn" =~ ^[Yy]$ ]] || exit 1
        ;;
esac

# ── [1/9] Aggiornamento sistema ───────────────────────────────────────────────
echo "==> [1/9] Aggiornamento sistema e pacchetti base..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release \
    git ufw fail2ban \
    htop ncdu nano unzip \
    unattended-upgrades apt-listchanges

# Aggiornamenti di sicurezza automatici (solo security, non upgrade completi)
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

# ── [2/9] Timezone e NTP ──────────────────────────────────────────────────────
echo "==> [2/9] Timezone ($TIMEZONE) e sincronizzazione orario..."
timedatectl set-timezone "$TIMEZONE"
systemctl enable systemd-timesyncd
systemctl start  systemd-timesyncd
timedatectl status

# ── [3/9] Swap file (2 GB) ───────────────────────────────────────────────────
echo "==> [3/9] Swap file ($SWAP_SIZE)..."
if [ ! -f /swapfile ]; then
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "    Swap creato e attivato."
else
    echo "    Swap già presente, skip."
fi
# Swappiness bassa: usa la RAM finché possibile, swap solo in emergenza
sysctl -w vm.swappiness=10 > /dev/null
echo 'vm.swappiness=10' >> /etc/sysctl.d/99-posmanager.conf

# ── [4/9] Kernel tuning per rete e I/O ──────────────────────────────────────
echo "==> [4/9] Ottimizzazioni kernel (sysctl)..."
cat > /etc/sysctl.d/99-posmanager.conf <<'EOF'
# Rete — coda connessioni più grande (utile con nginx sotto carico)
net.core.somaxconn        = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# Swappiness bassa (RAM da usare al massimo)
vm.swappiness             = 10

# File descriptor aumentati (Docker + nginx + MySQL)
fs.file-max               = 1000000

# TIME_WAIT riciclato più velocemente
net.ipv4.tcp_tw_reuse     = 1
net.ipv4.tcp_fin_timeout  = 15
EOF
sysctl --system > /dev/null 2>&1

# Limite file descriptor per i servizi
cat >> /etc/security/limits.conf <<'EOF'
* soft nofile 65535
* hard nofile 65535
EOF

# ── [5/9] Docker Engine ───────────────────────────────────────────────────────
echo "==> [5/9] Installazione Docker Engine..."
if ! command -v docker &>/dev/null; then
    install -m 0755 -d /etc/apt/keyrings

    # Il repo Docker usa URL diversi per Ubuntu e Debian
    DOCKER_DISTRO="$OS_ID"   # "ubuntu" oppure "debian"
    curl -fsSL "https://download.docker.com/linux/${DOCKER_DISTRO}/gpg" \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
      https://download.docker.com/linux/${DOCKER_DISTRO} ${OS_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    systemctl enable docker
    systemctl start  docker

    # Log rotation Docker: max 50 MB per container, 3 file
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'DOCKEREOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  }
}
DOCKEREOF
    systemctl restart docker
else
    echo "    Docker già installato ($(docker --version | cut -d' ' -f3)), skip."
fi
docker --version
docker compose version

# ── [6/9] Utente deploy ───────────────────────────────────────────────────────
echo "==> [6/9] Creazione utente '$DEPLOY_USER'..."
if ! id "$DEPLOY_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$DEPLOY_USER"
    usermod -aG docker "$DEPLOY_USER"
    PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
    echo "$DEPLOY_USER:$PASS" | chpasswd
    echo ""
    echo "    ┌──────────────────────────────────────────────────┐"
    echo "    │  CREDENZIALI UTENTE DEPLOY — SALVA ORA           │"
    echo "    │                                                  │"
    echo "    │  Utente:   $DEPLOY_USER                          │"
    printf "    │  Password: %-38s│\n" "$PASS"
    echo "    │                                                  │"
    echo "    │  Non verrà mostrata di nuovo.                    │"
    echo "    └──────────────────────────────────────────────────┘"
    echo ""
else
    echo "    Utente '$DEPLOY_USER' già esistente."
    # Assicura che sia nel gruppo docker anche se esisteva già
    usermod -aG docker "$DEPLOY_USER" 2>/dev/null || true
fi

# ── [7/9] Firewall UFW ───────────────────────────────────────────────────────
echo "==> [7/9] Configurazione firewall (UFW)..."
ufw --force reset > /dev/null
ufw default deny  incoming
ufw default allow outgoing
ufw allow 22/tcp  comment "SSH"
ufw allow 80/tcp  comment "HTTP"
ufw allow 443/tcp comment "HTTPS"
ufw --force enable
ufw status verbose

# ── [8/9] fail2ban ───────────────────────────────────────────────────────────
echo "==> [8/9] Configurazione fail2ban..."
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 2h
findtime = 10m
maxretry = 5

[sshd]
enabled  = true
port     = ssh
logpath  = %(sshd_log)s
backend  = %(sshd_backend)s
EOF
systemctl enable fail2ban
systemctl restart fail2ban

# ── [9/9] Clone repository ───────────────────────────────────────────────────
echo "==> [9/9] Clone del repository in $APP_DIR..."
if [ ! -d "$APP_DIR" ]; then
    git clone "$REPO_URL" "$APP_DIR"
    chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"
    echo "    Clonato in $APP_DIR"
else
    echo "    $APP_DIR già presente, skip clone."
    chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"
fi

# Crea directory backups con i permessi giusti
mkdir -p "$APP_DIR/backups"
chown "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR/backups"

# ── MOTD informativo ─────────────────────────────────────────────────────────
cat > /etc/motd <<EOF

  ╔══════════════════════════════════════════╗
  ║  POSMANAGER — VPS OVH                   ║
  ║  vps-008f120b.vps.ovh.net              ║
  ║  162.19.226.27 · 4 vCPU · 8 GB · 75 GB ║
  ╠══════════════════════════════════════════╣
  ║  App:     /opt/posmanager               ║
  ║  Deploy:  bash scripts/deploy.sh        ║
  ║  Backup:  bash scripts/backup_mysql.sh  ║
  ║  Log:     docker compose ... logs -f    ║
  ╚══════════════════════════════════════════╝

EOF

# ── Riepilogo ─────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  SETUP COMPLETATO ✅                                                 ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║                                                                      ║"
echo "║  Prossimi passi (come utente $DEPLOY_USER):                         ║"
echo "║                                                                      ║"
echo "║  su - $DEPLOY_USER                                                   ║"
echo "║  cd $APP_DIR                                                         ║"
echo "║                                                                      ║"
echo "║  1. cp .env.production.example .env && nano .env                     ║"
echo "║     → imposta DOMAIN, CERTBOT_EMAIL, password, SECRET_KEY           ║"
echo "║                                                                      ║"
echo "║  2. docker compose -f docker-compose.prod.yml up -d                  ║"
echo "║     → avvia tutto in HTTP (phase 1)                                  ║"
echo "║                                                                      ║"
echo "║  3. bash scripts/init_ssl.sh                                         ║"
echo "║     → ottieni il certificato Let's Encrypt e attiva HTTPS           ║"
echo "║                                                                      ║"
echo "║  4. crontab -e  →  aggiungi il backup giornaliero:                  ║"
echo "║     0 4 * * * $APP_DIR/scripts/backup_mysql.sh                      ║"
echo "║             (OVH fa snapshot VM alle 03:xx, quindi alle 04:00)      ║"
echo "║                                                                      ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Risorse allocate ai container:"
echo "    MySQL   → 3 GB RAM, innodb_buffer_pool=2G"
echo "    Backend → 1 GB RAM, 4 workers uvicorn"
echo "    nginx   → 128 MB RAM"
echo "    Totale  → ~4.2 GB / 8 GB disponibili"
echo ""
