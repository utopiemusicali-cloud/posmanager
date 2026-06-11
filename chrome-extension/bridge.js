// bridge.js — gira sulla pagina web POSMANAGER.
// 1) Legge il token dalla sessione già loggata e lo passa all'estensione (auto-connect)
// 2) Fa da ponte tra la web app e l'estensione (comandi start/stop + release da scrapare)
// 3) Segnala alla web app che l'estensione è installata

function readToken() {
  try {
    const raw = localStorage.getItem('posmanager-auth')
    if (!raw) return null
    const j = JSON.parse(raw)
    return (j && j.state && j.state.token) || null
  } catch { return null }
}

function syncAuth() {
  const token = readToken()
  if (token) {
    chrome.runtime.sendMessage({ type: 'setAuth', server: location.origin, token })
  }
}

// auto-connessione + refresh periodico del token
syncAuth()
setInterval(syncAuth, 5000)

// la web app chiede di avviare/fermare lo scraping
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__posmanager !== true) return
  const d = e.data
  if (d.action === 'scrape-start') {
    chrome.runtime.sendMessage(
      { type: 'start', status: d.status || 'For Sale', release_ids: d.release_ids || null },
      (r) => window.postMessage({ __posmanager_resp: true, action: 'started', result: r }, '*')
    )
  } else if (d.action === 'scrape-stop') {
    chrome.runtime.sendMessage({ type: 'stop' })
  } else if (d.action === 'scrape-status') {
    chrome.runtime.sendMessage({ type: 'status' },
      (r) => window.postMessage({ __posmanager_resp: true, action: 'status', result: r }, '*'))
  }
})

// presenza estensione (la web app può mostrarne lo stato)
function announce() { window.postMessage({ __posmanager_ext: true }, '*') }
announce()
setInterval(announce, 3000)
