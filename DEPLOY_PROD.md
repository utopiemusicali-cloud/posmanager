# Deploy in produzione — VPS OVH (Ubuntu 22.04)

## Specifiche VPS

| | |
|---|---|
| **Hostname OVH** | `vps-008f120b.vps.ovh.net` |
| **IPv4** | `162.19.226.27` |
| **IPv6** | `2001:41d0:701:1100::2a34` |
| **CPU** | 4 vCPU |
| **RAM** | 8 GB |
| **Disco** | 75 GB NVMe |
| **OS** | Ubuntu 22.04 LTS ✅ |
| **Utente SSH** | `ubuntu` |

---

## Prerequisiti prima di iniziare

- [x] Ubuntu 22.04 LTS installato ✅
- [x] Credenziali SSH ricevute: utente `ubuntu` ✅
- [ ] Firewall OVH: porte TCP 22, 80, 443 aperte (pannello OVH Manager → Bare Metal Cloud → IP → Firewall)
- [ ] Repo GitHub creato e codice pushato

---

## Fase 0 — Setup del server (una sola volta)

```bash
# Accedi al server
ssh ubuntu@vps-008f120b.vps.ovh.net
# oppure via IP:  ssh ubuntu@162.19.226.27

# Esegui lo script di setup
# (installa Docker, swap, kernel tuning, firewall UFW, fail2ban, utente deploy)
curl -fsSL https://raw.githubusercontent.com/utopiemusicali-cloud/posmanager/main/scripts/setup_server.sh | sudo bash
```

Oppure se hai già clonato il repo sul server:
```bash
sudo bash /opt/posmanager/scripts/setup_server.sh
```

Lo script fa (in ordine):
1. Rileva OS automaticamente (Debian 12 ✅ / Ubuntu 22.04-24.04)
2. Aggiorna il sistema e installa pacchetti base
3. Imposta timezone `Europe/Rome` + NTP
4. Crea swap file 2 GB (sicurezza durante build Docker)
5. Kernel tuning: `somaxconn=65535`, `swappiness=10`, `file-max=1000000`
6. Installa Docker Engine + Compose plugin (repo corretto per Debian)
7. Crea utente `posmanager` (mostra la password — **salvala**)
8. Configura UFW (22/80/443) + fail2ban
9. Clona il repo in `/opt/posmanager`

---

## Fase 1 — Configurazione .env

```bash
# Passa all'utente deploy
su - posmanager
cd /opt/posmanager

# Crea il file .env dalla configurazione di esempio
cp .env.production.example .env
nano .env
```

**Valori obbligatori da modificare:**

| Variabile | Esempio |
|-----------|---------|
| `DOMAIN` | `posmanager.miodominio.com` |
| `CERTBOT_EMAIL` | `admin@miodominio.com` |
| `CERTBOT_WWW` | `true` se hai record DNS per `www.` altrimenti `false` |
| `MYSQL_ROOT_PASSWORD` | password sicura |
| `MYSQL_PASSWORD` | password sicura |
| `DATABASE_URL` | aggiorna la password (stesso valore di `MYSQL_PASSWORD`) |
| `SECRET_KEY` | `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `FIRST_ADMIN_PASSWORD` | password per il primo accesso all'app |
| `CORS_ORIGINS` | `https://posmanager.miodominio.com` |

**Record DNS da configurare nel tuo provider DNS:**
```
A    @              162.19.226.27
A    www            162.19.226.27
AAAA @              2001:41d0:701:1100::2a34   (opzionale IPv6)
```

---

## Fase 2 — Primo avvio (HTTP only)

```bash
# Prima volta: avvia tutti i servizi in modalità HTTP
docker compose -f docker-compose.prod.yml up -d

# Controlla che tutto sia partito
docker compose -f docker-compose.prod.yml ps

# Verifica il backend
curl http://localhost/api/health
```

Dovresti vedere:
```
NAME               STATUS
mysql              Up (healthy)
backend            Up
nginx              Up
certbot            Up
frontend_builder   Exited (0)   ← normale, ha solo copiato i file e si è fermato
```

---

## Fase 3 — Certificato SSL (Let's Encrypt)

> ⚠️ Prima di questo step il DNS **deve** già puntare a `162.19.226.27`.  
> Verifica con: `nslookup tuodominio.com` — deve rispondere con `162.19.226.27`.

```bash
bash scripts/init_ssl.sh
```

Lo script:
1. Confronta l'IP del server con quello restituito dal DNS
2. Verifica che nginx risponda sulla porta 80
3. Acquisisce il certificato tramite il container certbot (webroot challenge)
4. Fa backup di `default.conf` → `default.http-only.bak`
5. Genera `nginx/conf.d/default.conf` con il dominio corretto
6. Riavvia nginx in modalità HTTPS

---

## Fase 4 — Migrazione dati da SQLite (opzionale)

Se hai dati storici nel vecchio GP V3:

```bash
# Dal tuo PC Windows, copia il file .db sul server:
scp "G:\Il mio Drive\PointOfSale\TEST\GP V3\database\posmanager.db" \
    posmanager@vps-008f120b.vps.ovh.net:/opt/posmanager/posmanager.db

# Sul server: copia il .db nel container backend
docker compose -f docker-compose.prod.yml cp \
    posmanager.db backend:/tmp/posmanager.db

# Esegui la migrazione
docker compose -f docker-compose.prod.yml exec backend \
    python scripts/migrate_sqlite_to_mysql.py \
    --sqlite /tmp/posmanager.db \
    --mysql "mysql+pymysql://posmanager:LA_TUA_PASSWORD@mysql:3306/posmanager"
```

> 💡 **Prima della migrazione**: fai uno snapshot manuale dal pannello OVH (sicurezza extra).

---

## Backup

### Backup OVH (già attivi con il tuo ordine)
| Tipo | Frequenza | Rotazioni | Dove gestire |
|------|-----------|-----------|--------------|
| **Automated Backup Premium** | Giornaliero automatico | 7 | Pannello OVH Manager |
| **Snapshot manuale** | On-demand | Illimitati (paghi per slot) | Pannello OVH Manager |

Questi coprono **l'intera VM**: OS, Docker volumes, database.  
Restore dal pannello OVH in ~10 minuti.

### Backup applicativo MySQL (dump SQL — consigliato in aggiunta)

> Utile per restore **selettivo** di singole tabelle senza ripristinare l'intera VM.

```bash
# Installa il cron job per il dump giornaliero alle 04:00
# (OVH fa snapshot ~03:xx → noi facciamo il dump subito dopo)
crontab -e
```
Aggiungi:
```cron
0 4 * * * /opt/posmanager/scripts/backup_mysql.sh >> /var/log/posmanager-backup.log 2>&1
```

I dump vengono salvati in `/opt/posmanager/backups/` compressi `.sql.gz`, mantenuti 14 giorni (~70 MB totali su 75 GB).

### Restore da dump SQL
```bash
# Ripristina un backup specifico (esempio)
zcat /opt/posmanager/backups/posmanager_20250601_040000.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T mysql \
    mysql -u posmanager -p"${MYSQL_PASSWORD}" posmanager
```

---

## Aggiornamenti futuri

Ogni volta che fai `git push` sul repo:

```bash
cd /opt/posmanager
bash scripts/deploy.sh
```

Lo script:
1. Backup DB pre-deploy
2. `git pull`
3. Build immagini modificate (backend + frontend)
4. Aggiorna il volume frontend_static
5. Riavvia backend + migrazioni Alembic
6. Reload nginx
7. Health check + pulizia immagini obsolete

---

## Comandi utili

```bash
# Stato servizi
docker compose -f docker-compose.prod.yml ps

# Log in tempo reale
docker compose -f docker-compose.prod.yml logs -f

# Log solo backend
docker compose -f docker-compose.prod.yml logs -f backend

# Riavvio di emergenza (con SSL attivo)
docker compose -f docker-compose.prod.yml -f docker-compose.ssl.yml \
    up -d --force-recreate

# Backup manuale immediato
bash scripts/backup_mysql.sh

# Accesso al database
docker compose -f docker-compose.prod.yml exec mysql \
    mysql -u posmanager -p posmanager

# Shell nel container backend
docker compose -f docker-compose.prod.yml exec backend bash

# Verifica scadenza certificato SSL
docker compose -f docker-compose.prod.yml exec certbot certbot certificates

# Spazio disco
df -h && du -sh /opt/posmanager/backups/
```

---

## Struttura rete

```
Internet
    │
  DNS A:  tuodominio.com → 162.19.226.27
  DNS A:  www.           → 162.19.226.27
  DNS AAAA (opz.):       → 2001:41d0:701:1100::2a34
    │
[OVH VPS — vps-008f120b.vps.ovh.net — 162.19.226.27]
    │
  OVH Firewall: 22/80/443 ✅
  UFW (software): 22/80/443 ✅
    │
  nginx:alpine
    ├── HTTP  :80  → redirect HTTPS + ACME challenge (Let's Encrypt)
    └── HTTPS :443 (TLS 1.2/1.3, HSTS, certbot auto-rinnovo)
          ├── /       → React SPA  (volume Docker frontend_static)
          └── /api    → FastAPI backend :8000
                           └── MySQL 8.0 :3306
                                   └── Volume mysql_data (75 GB NVMe)
```

---

## Rinnovo certificati

Il container `certbot` rinnova automaticamente ogni 12 ore.  
I certificati scadono ogni 90 giorni ma vengono rinnovati dopo 60 giorni.

```bash
# Verifica scadenza
docker compose -f docker-compose.prod.yml exec certbot certbot certificates

# Rinnovo forzato (se necessario)
docker compose -f docker-compose.prod.yml exec certbot certbot renew --force-renewal
```
