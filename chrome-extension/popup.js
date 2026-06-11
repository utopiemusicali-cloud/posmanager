const $ = (id) => document.getElementById(id)
const send = (msg) => new Promise(res => chrome.runtime.sendMessage(msg, res))

async function refresh() {
  const st = await send({ type: 'status' })
  if (!st) return
  $('conn').innerHTML = st.hasToken
    ? '<span class="ok">✓ Connesso automaticamente</span>'
    : '<span style="color:#e67e22">⚠ Apri la web app POSMANAGER (loggato) per connettere</span>'
  const pct = st.total ? Math.round(st.processed / st.total * 100) : 0
  $('status').textContent = st.running
    ? `In corso… ${st.processed}/${st.total} (${st.errors} errori)`
    : (st.total ? `Fermo — ${st.processed}/${st.total} completati (${st.errors} errori)` : 'Pronto')
  $('barFill').style.width = pct + '%'
  $('errBox').textContent = st.lastError || ''
}

$('startBtn').onclick = async () => {
  const r = await send({ type: 'start', status: $('statusFilter').value.trim() })
  if (r && r.error) $('errBox').textContent = r.error
  refresh()
}
$('stopBtn').onclick = async () => { await send({ type: 'stop' }); refresh() }

setInterval(refresh, 1500)
refresh()
