# POSMANAGER — Estensione Chrome per scraping Discogs

Scrapa storico vendite + mercato delle release Discogs usando **la tua sessione Chrome**
(loggato + clearance Cloudflare già valida) e li invia al server POSMANAGER.
Niente più SeleniumBase o script da terminale.

## Installazione (una volta)

1. Apri Chrome → `chrome://extensions`
2. Attiva **"Modalità sviluppatore"** (in alto a destra)
3. Clicca **"Carica estensione non pacchettizzata"**
4. Seleziona la cartella `chrome-extension/`
5. L'icona compare nella barra. (Fissala con la puntina per comodità.)

## Uso

1. Apri **discogs.com** e assicurati di essere **loggato**.
2. Clicca l'icona dell'estensione → popup:
   - **Server URL**: già impostato (`https://vps-008f120b.vps.ovh.net`)
   - **Utente / Password**: le credenziali admin di POSMANAGER → **Connetti**
3. **Stato articoli**: `For Sale` (default) — scrapa solo quelli in vendita senza dati.
4. **Avvia**: parte lo scraping in background.
   - La coda viene presa dal server (`sales-todo` = release senza dati vendita).
   - Avanza ~1 release ogni ~5 secondi (rispetta i limiti).
   - Puoi continuare a navigare; tieni **almeno una scheda discogs.com aperta**.
5. La barra mostra il progresso. **Stop** per fermare (riprendibile: riparte dai mancanti).

## Note

- Se compare "sessione Cloudflare da rinnovare": ricarica una pagina Discogs (così
  rinnovi la clearance) e premi di nuovo **Avvia**.
- Tieni **una sola** scheda discogs.com per evitare doppioni.
- I dati finiscono nella tabella `release_sales` del server → visibili nel pannello
  📊 "Vendite & Mercato" dell'inventario.

## Sicurezza

L'estensione comunica solo con `discogs.com` (lettura pagine) e col tuo server
POSMANAGER (invio dati). Le credenziali admin e il token restano in locale
(`chrome.storage`), non vengono mai inviate a Discogs.
