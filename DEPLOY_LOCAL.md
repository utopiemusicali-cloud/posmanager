# Deploy locale su mini PC (Windows + LAN)

## Prerequisiti sul mini PC

### 1 — Abilita WSL2 (necessario per Docker Desktop su Windows)
Apri **PowerShell come Amministratore** ed esegui:

```powershell
wsl --install
```
Riavvia il PC quando richiesto.

### 2 — Installa Docker Desktop
- Scarica da: https://www.docker.com/products/docker-desktop/
- Installa, scegli il backend **WSL2** quando chiesto
- Dopo l'installazione, apri Docker Desktop e attendi che dica **"Engine running"**

Verifica da PowerShell:
```powershell
docker --version
docker compose version
```

### 3 — Installa Git
- Scarica da: https://git-scm.com/download/win
- Installa con le opzioni di default

---

## Metti il codice sul mini PC

### Sul PC principale (dove hai sviluppato)
Crea un repository Git e fai push su GitHub/GitLab:

```powershell
# Vai nella cartella del progetto
cd "G:\Il mio Drive\PointOfSale\posmanager"

git init
git add .
git commit -m "Initial commit — posmanager web app"

# Crea un repo su GitHub e poi:
git remote add origin https://github.com/utopiemusicali-cloud/posmanager.git
git push -u origin main
```

> ⚠️ Il file `.env` è nel `.gitignore` e non viene pushato — bene così.

### Sul mini PC
Apri PowerShell e clona:

```powershell
git clone https://github.com/utopiemusicali-cloud/posmanager.git
cd posmanager
```

---

## Configura il .env sul mini PC

### Trova l'IP del mini PC in LAN
```powershell
ipconfig
# Cerca "Indirizzo IPv4" — es. 192.168.1.100
```

### Crea il file .env
```powershell
Copy-Item .env.local.example .env
notepad .env
```

Modifica questi valori obbligatori:
```env
MYSQL_PASSWORD=una_password_sicura
DATABASE_URL=mysql+asyncmy://posmanager:una_password_sicura@mysql:3306/posmanager
SECRET_KEY=STRINGA_CASUALE_64_CARATTERI   # vedi sotto
LOCAL_IP=192.168.1.100                    # il tuo IP LAN
FIRST_ADMIN_PASSWORD=la_tua_password
```

Genera la SECRET_KEY:
```powershell
python -c "import secrets; print(secrets.token_hex(32))"
# Se Python non è installato, usa: https://www.uuidgenerator.net/
```

---

## Avvia l'applicazione

```powershell
# Prima volta: build + avvio (ci vuole 3-5 min per scaricare le immagini)
docker compose -f docker-compose.local.yml up --build -d

# Controlla che tutto sia partito
docker compose -f docker-compose.local.yml ps
```

Dovresti vedere 3 servizi **Up**:
```
NAME          STATUS
mysql         Up (healthy)
backend       Up
frontend      Up
```

### Verifica dal browser
Sul mini PC stesso:
```
http://localhost
```

Da qualsiasi altro dispositivo nella stessa rete WiFi/LAN:
```
http://192.168.1.100        ← usa l'IP del mini PC
```

Login con le credenziali che hai messo in `.env` (`FIRST_ADMIN_USERNAME` / `FIRST_ADMIN_PASSWORD`).

---

## Migra i dati da SQLite (opzionale)

Se vuoi portare i dati storici dal vecchio GP V3:

```powershell
# Copia il file .db sul mini PC (via rete o USB)
# poi esegui lo script dentro il container backend:
docker compose -f docker-compose.local.yml exec backend python scripts/migrate_sqlite_to_mysql.py \
  --sqlite /path/to/posmanager.db \
  --mysql "mysql+pymysql://posmanager:PASSWORD@mysql:3306/posmanager"
```

Oppure dal PC principale (se MySQL è raggiungibile):
```powershell
cd "G:\Il mio Drive\PointOfSale\posmanager\backend"
pip install pymysql
python scripts/migrate_sqlite_to_mysql.py \
  --sqlite "G:\Il mio Drive\PointOfSale\TEST\GP V3\database\posmanager.db" \
  --mysql "mysql+pymysql://posmanager:PASSWORD@192.168.1.100:3306/posmanager"
```
> Per quest'ultimo metodo, esponi temporaneamente la porta MySQL nel compose: aggiungi `ports: ["3306:3306"]` al servizio mysql.

---

## Comandi utili

```powershell
# Ferma tutto (dati preservati)
docker compose -f docker-compose.local.yml down

# Ferma e CANCELLA i dati MySQL (attenzione!)
docker compose -f docker-compose.local.yml down -v

# Aggiorna dopo un git pull
git pull
docker compose -f docker-compose.local.yml up --build -d

# Vedi i log in tempo reale
docker compose -f docker-compose.local.yml logs -f

# Log solo del backend
docker compose -f docker-compose.local.yml logs -f backend

# Accedi al container backend (debug)
docker compose -f docker-compose.local.yml exec backend bash
```

---

## Firewall Windows

Se gli altri dispositivi non riescono a raggiungere l'app, il firewall di Windows potrebbe bloccare la porta 80.

Apri **PowerShell come Amministratore**:
```powershell
New-NetFirewallRule -DisplayName "POSMANAGER HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

---

## Struttura rete

```
[iPhone / Tablet / PC]
        |
    WiFi/LAN
        |
  [Mini PC :80]  ←── nginx
                      ├── /           → React SPA
                      └── /api        → FastAPI :8000
                                           └── MySQL :3306
```
