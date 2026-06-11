// bridge.js — gira sulla pagina web POSMANAGER.
// Ponte SICURO web app ↔ estensione. NON tocca token né server.
// La web app chiede di scrapare una release; il bridge inoltra al background
// e restituisce i dati scrapati alla web app (che li salva lei sul server).

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__posmanager !== true) return
  const d = e.data
  if (d.action === 'scrape' && d.release_id) {
    chrome.runtime.sendMessage({ type: 'scrapeRelease', release_id: d.release_id }, (resp) => {
      window.postMessage({
        __posmanager_resp: true,
        reqId: d.reqId,
        data: resp && resp.ok ? resp.data : null,
        error: resp && resp.ok ? null : ((resp && resp.error) || 'Estensione: errore scraping'),
      }, '*')
    })
  }
})

// Annuncia la presenza dell'estensione alla web app
function announce() { window.postMessage({ __posmanager_ext: true }, '*') }
announce()
setInterval(announce, 3000)
