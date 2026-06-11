// background.js — service worker = SOLO relay di messaggi (MV3-compliant).
// Nessun token, nessuna chiamata al server: l'estensione scrapa e basta.
// Flusso: web app → bridge → background → content script (discogs) → dati indietro.

const DISCOGS_TAB_TIMEOUT = 20000

// Trova una scheda Discogs aperta (loggata); se non c'è, ne crea una in background.
async function getDiscogsTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.discogs.com/*' })
  if (tabs.length) return tabs[0]
  // Crea una tab Discogs e aspetta che il content script sia pronto
  const tab = await chrome.tabs.create({ url: 'https://www.discogs.com/', active: false })
  await new Promise((resolve) => {
    const start = Date.now()
    const iv = setInterval(async () => {
      try {
        const t = await chrome.tabs.get(tab.id)
        if (t.status === 'complete' || Date.now() - start > DISCOGS_TAB_TIMEOUT) {
          clearInterval(iv); resolve()
        }
      } catch { clearInterval(iv); resolve() }
    }, 500)
  })
  return tab
}

async function scrapeRelease(releaseId) {
  const tab = await getDiscogsTab()
  if (!tab) throw new Error('Nessuna scheda Discogs disponibile')
  // Chiede al content script della tab di scrapare la release
  const resp = await chrome.tabs.sendMessage(tab.id, { type: 'scrapeOne', release_id: releaseId })
  if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'Scraping fallito')
  return resp.data
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'scrapeRelease' && msg.release_id) {
    scrapeRelease(String(msg.release_id))
      .then(data => sendResponse({ ok: true, data }))
      .catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }))
    return true // risposta async (mantiene vivo il SW fino alla risposta)
  }
  if (msg && msg.type === 'ping') { sendResponse({ ok: true }); return false }
})
