const $ = (id) => document.getElementById(id)
const send = (msg) => new Promise(res => chrome.runtime.sendMessage(msg, res))

async function refresh() {
  const st = await send({ type: 'status' })
  if (!st) return
  $('loginMsg').innerHTML = st.hasToken
    ? '<span class="ok">✓ Connesso</span>'
    : '<span style="color:#888">Non connesso</span>'
  const pct = st.total ? Math.round(st.processed / st.total * 100) : 0
  $('status').textContent = st.running
    ? `In corso… ${st.processed}/${st.total} (${st.errors} errori)`
    : (st.total ? `Fermo — ${st.processed}/${st.total} completati (${st.errors} errori)` : 'Pronto')
  $('barFill').style.width = pct + '%'
  $('errBox').textContent = st.lastError || ''
}

$('loginBtn').onclick = async () => {
  $('loginMsg').textContent = 'Connessione…'
  const r = await send({
    type: 'login', server: $('server').value.trim().replace(/\/$/, ''),
    user: $('user').value.trim(), pass: $('pass').value,
  })
  $('loginMsg').innerHTML = r && r.ok
    ? '<span class="ok">✓ Connesso</span>'
    : `<span style="color:#e74c3c">${(r && r.error) || 'Errore'}</span>`
  refresh()
}

$('startBtn').onclick = async () => {
  const r = await send({ type: 'start', status: $('statusFilter').value.trim() })
  if (r && r.started) $('status').textContent = `Avviato: ${r.total} release in coda`
  else if (r && r.error) $('errBox').textContent = r.error
  refresh()
}

$('stopBtn').onclick = async () => { await send({ type: 'stop' }); refresh() }

setInterval(refresh, 1500)
refresh()
