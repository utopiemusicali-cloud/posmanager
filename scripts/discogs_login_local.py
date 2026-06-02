"""
Login Discogs manuale (sul TUO PC) per generare i cookie di sessione.
Serve perché sul server (headless) il captcha non è risolvibile a mano.

── USO (sul tuo PC Windows, una volta sola / quando i cookie scadono) ──────────
1. Installa Playwright (se non l'hai):
       pip install playwright
       playwright install firefox
2. Esegui questo script:
       python discogs_login_local.py
3. Si apre Firefox: fai login su Discogs (anche col captcha).
4. Torna sul terminale e premi INVIO.
   → viene creato il file  discogs_state.json  nella cartella corrente.

── POI carica il file sul server ──────────────────────────────────────────────
   scp discogs_state.json ubuntu@vps-008f120b.vps.ovh.net:/home/ubuntu/
   ssh ubuntu@vps-008f120b.vps.ovh.net
   cd /opt/posmanager
   docker compose -f docker-compose.prod.yml cp /home/ubuntu/discogs_state.json backend:/inventory/discogs_state.json
   docker compose -f docker-compose.prod.yml restart backend
"""
from playwright.sync_api import sync_playwright
import os

OUT = "discogs_state.json"

with sync_playwright() as p:
    browser = p.firefox.launch(headless=False)
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto("https://www.discogs.com/login", wait_until="domcontentloaded")
    print("\n" + "=" * 60)
    print("  Fai LOGIN su Discogs nel browser appena aperto")
    print("  (inserisci credenziali e risolvi l'eventuale captcha)")
    print("=" * 60)
    input("\n>>> Quando hai completato il login, premi INVIO qui... ")
    ctx.storage_state(path=OUT)
    print(f"\n✅ Sessione salvata in: {os.path.abspath(OUT)}")
    browser.close()
