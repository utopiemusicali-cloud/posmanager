// content.js — gira su www.discogs.com.
// Fa fetch same-origin alle pagine sell (Cloudflare passa con la tua sessione),
// fa il parsing e manda i risultati al service worker.

const BASE = 'https://www.discogs.com'
const SLEEP = 3000
const CF_MARKERS = ['just a moment', 'verifica di sicurezza', 'performing security',
  'verifying you are human', 'challenge-platform']

const COND_RE = /(Mint \(M\)|Near Mint \(NM or M-\)|Very Good Plus \(VG\+\)|Very Good \(VG\)|Good Plus \(G\+\)|Good \(G\)|Fair \(F\)|Poor \(P\)|Generic|No Cover|Not Graded)/

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function num(text) {
  const m = (text || '').match(/[\d.,]+/)
  if (!m) return null
  let s = m[0]
  try {
    if (s.includes(',') && !s.includes('.')) return parseFloat(s.replace(/\./g, '').replace(',', '.'))
    return parseFloat(s.replace(/,/g, ''))
  } catch { return null }
}
function cur(text) {
  if (text.includes('€')) return 'EUR'
  if (text.includes('£')) return 'GBP'
  if (text.includes('CA$')) return 'CAD'
  if (text.includes('$')) return 'USD'
  return 'EUR'
}
function cleanCond(text) {
  const m = (text || '').match(COND_RE)
  return m ? m[1] : (text || '').trim()
}

function parseHistory(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const sales = []
  for (const table of doc.querySelectorAll('table')) {
    const ths = [...table.querySelectorAll('th')]
    if (!ths.some(th => /date/i.test(th.textContent))) continue
    for (const row of table.querySelectorAll('tr.sales-history-row')) {
      const cells = row.querySelectorAll('td')
      if (cells.length < 4) continue
      const date = cells[0].textContent.trim()
      const priceTxt = cells[3].textContent.trim()
      const price = num(priceTxt)
      if (!date || price == null) continue
      sales.push({ date, media: cleanCond(cells[1].textContent), sleeve: cleanCond(cells[2].textContent), price, currency: cur(priceTxt) })
    }
    break
  }
  const out = { sales_history: sales, sales_count: sales.length, min_price: null, max_price: null, median_price: null, avg_price: null, last_sold_price: null, last_sold_date: '' }
  const prices = sales.map(s => s.price)
  if (prices.length) {
    const sp = [...prices].sort((a, b) => a - b)
    out.min_price = Math.min(...prices)
    out.max_price = Math.max(...prices)
    out.median_price = sp[Math.floor(sp.length / 2)]
    out.avg_price = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100
    out.last_sold_price = sales[0].price
    out.last_sold_date = sales[0].date
  }
  return out
}

function parseMarket(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const listings = []
  let itemsForSale = null
  const tot = doc.querySelector('.pagination_total')
  if (tot) {
    const m = tot.textContent.match(/of\s+([\d,]+)/)
    if (m) itemsForSale = parseInt(m[1].replace(/,/g, ''))
  }
  const table = doc.querySelector('table.mpitems')
  if (table) {
    for (const row of table.querySelectorAll('tbody > tr')) {
      const desc = row.querySelector('td.item_description')
      const sellerTd = row.querySelector('td.seller_info')
      if (!desc) continue
      let media = '', sleeve = ''
      const mc = desc.querySelector('.item_condition')
      if (mc) { const m = mc.textContent.match(COND_RE); if (m) media = m[1] }
      const sl = desc.querySelector('.item_sleeve_condition')
      if (sl) { const m = sl.textContent.match(COND_RE); sleeve = m ? m[1] : sl.textContent.trim() }
      // commenti venditore (p.hide_mobile che non è label_and_cat né condition)
      let comments = ''
      const cp = desc.querySelector('p.hide_mobile:not(.label_and_cat)')
      if (cp && !cp.querySelector('.mplabel')) comments = cp.textContent.trim()
      let price = null, ship = null, total = null, curr = 'EUR'
      const ps = row.querySelector('.item_price .price, .price')
      if (ps) { curr = cur(ps.textContent); const pv = ps.getAttribute('data-pricevalue'); price = pv ? parseFloat(pv) : num(ps.textContent) }
      const sh = row.querySelector('.item_shipping')
      if (sh) ship = num(sh.textContent)
      const cv = row.querySelector('.converted_price')
      if (cv) total = num(cv.textContent)
      let seller = '', fbPct = '', shipFrom = '', fbCount = null
      if (sellerTd) {
        const su = sellerTd.querySelector("a[href*='/seller/']")
        if (su) seller = su.textContent.trim()
        const fb = [...sellerTd.querySelectorAll('strong')].find(s => /%/.test(s.textContent))
        if (fb) fbPct = fb.textContent.trim()
        const fc = sellerTd.querySelector("a[href*='seller_feedback']")
        if (fc) { const m = fc.textContent.match(/([\d,]+)/); if (m) fbCount = parseInt(m[1].replace(/,/g, '')) }
        for (const li of sellerTd.querySelectorAll('li')) {
          const t = li.textContent.replace(/\s+/g, ' ').trim()
          if (t.includes('Ships From')) shipFrom = t.split('Ships From:').pop().trim()
        }
      }
      listings.push({ seller, feedback_pct: fbPct, feedback_count: fbCount, ship_from: shipFrom, media, sleeve, comments, price, shipping: ship, total, currency: curr })
    }
  }
  let have = null, want = null
  for (const res of doc.querySelectorAll('.community_result')) {
    const label = res.textContent.toLowerCase()
    const n = res.querySelector('.community_number')
    if (n) { const v = num(n.textContent); if (v != null) { if (label.includes('have')) have = Math.round(v); else if (label.includes('want')) want = Math.round(v) } }
  }
  return { market_listings: listings, items_for_sale: itemsForSale != null ? itemsForSale : listings.length, have, want, avg_rating: null, ratings_count: null }
}

async function fetchPage(url) {
  const html = await fetch(url, { credentials: 'include' }).then(r => r.text())
  if (CF_MARKERS.some(m => html.toLowerCase().includes(m))) {
    throw new Error('Cloudflare challenge — apri/ricarica una pagina Discogs per rinnovare la sessione')
  }
  return html
}

async function scrapeRelease(rid) {
  const h = await fetchPage(`${BASE}/sell/history/${rid}`)
  const hist = parseHistory(h)
  await sleep(1500)
  const m = await fetchPage(`${BASE}/sell/release/${rid}?sort=listed&sort_order=desc`)
  const market = parseMarket(m)
  return { ...hist, ...market }
}

// Gestisce la richiesta di scraping di UNA release (dal background).
// Risponde con i dati o un errore. Nessuna comunicazione col server qui.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'scrapeOne' && msg.release_id) {
    scrapeRelease(String(msg.release_id))
      .then(data => sendResponse({ ok: true, data }))
      .catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }))
    return true // risposta async
  }
})
