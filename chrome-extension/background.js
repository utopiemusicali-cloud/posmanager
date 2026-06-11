// background.js — service worker.
// Gestisce login al server, coda release, invio dati a /sales-ingest.
// I fetch dal service worker (host in host_permissions) bypassano la CORS.

async function getState() {
  return await chrome.storage.local.get([
    'server', 'token', 'running', 'queue', 'idx', 'processed', 'errors', 'total', 'lastError',
  ])
}
async function setState(obj) { await chrome.storage.local.set(obj) }

async function serverFetch(path, opts = {}) {
  const s = await getState()
  const headers = opts.headers || {}
  if (s.token) headers['Authorization'] = `Bearer ${s.token}`
  return fetch(`${s.server}${path}`, { ...opts, headers })
}

async function login(server, user, pass) {
  const body = new URLSearchParams({ username: user, password: pass })
  const r = await fetch(`${server}/api/v1/auth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  if (!r.ok) throw new Error(`Login fallito (${r.status})`)
  const j = await r.json()
  await setState({ server, token: j.access_token })
  return true
}

async function start(status) {
  const s = await getState()
  if (!s.token) throw new Error('Non autenticato')
  // Carica la coda dei release da scrapare
  const r = await serverFetch(`/api/v1/inventory/sales-todo?status=${encodeURIComponent(status || 'For Sale')}&limit=20000`)
  const j = await r.json()
  const queue = j.todo || []
  await setState({ queue, idx: 0, processed: 0, errors: 0, total: queue.length, running: true, lastError: '' })
  // Apri/usa una tab Discogs per far girare il content script
  const tabs = await chrome.tabs.query({ url: 'https://www.discogs.com/*' })
  let tab = tabs[0]
  if (!tab) tab = await chrome.tabs.create({ url: 'https://www.discogs.com/', active: false })
  // Avvia il loop nel content script
  try { chrome.tabs.sendMessage(tab.id, { type: 'startLoop' }) } catch (e) { }
  return { started: true, total: queue.length }
}

async function stop() { await setState({ running: false }) }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const s = await getState()
      switch (msg.type) {
        case 'login':
          await login(msg.server, msg.user, msg.pass)
          sendResponse({ ok: true }); break
        case 'start':
          sendResponse(await start(msg.status)); break
        case 'stop':
          await stop(); sendResponse({ ok: true }); break
        case 'status':
          sendResponse({
            running: !!s.running, processed: s.processed || 0, total: s.total || 0,
            errors: s.errors || 0, hasToken: !!s.token, server: s.server || '', lastError: s.lastError || '',
          }); break
        case 'isRunning':
          sendResponse({ running: !!s.running }); break
        case 'next': {
          if (!s.running) { sendResponse({ done: true }); break }
          const q = s.queue || [], idx = s.idx || 0
          if (idx >= q.length) { sendResponse({ done: true }); break }
          await setState({ idx: idx + 1 })
          sendResponse({ release_id: q[idx] }); break
        }
        case 'result': {
          try {
            const resp = await serverFetch(`/api/v1/inventory/releases/${msg.release_id}/sales-ingest`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg.data),
            })
            if (!resp.ok) throw new Error(`ingest ${resp.status}`)
            await setState({ processed: (s.processed || 0) + 1 })
          } catch (e) {
            await setState({ errors: (s.errors || 0) + 1, lastError: String(e) })
          }
          sendResponse({ ok: true }); break
        }
        case 'error':
          await setState({ errors: (s.errors || 0) + 1, lastError: msg.error })
          sendResponse({ ok: true }); break
        case 'pause':
          await setState({ running: false, lastError: 'In pausa: sessione Cloudflare da rinnovare' })
          sendResponse({ ok: true }); break
        case 'finished':
          await setState({ running: false })
          sendResponse({ ok: true }); break
        default:
          sendResponse({ ok: false })
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) })
    }
  })()
  return true // risposta async
})
