// Ponte verso l'estensione Chrome POSMANAGER (scraping Discogs).
// La web app chiede all'estensione di scrapare una release e riceve i dati,
// che poi salva sul server col proprio token (il token NON passa all'estensione).

let extPresent = false

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__posmanager_ext) extPresent = true
  })
}

export function isExtensionPresent(): boolean {
  return extPresent
}

export interface ScrapedSales {
  sales_count: number
  min_price: number | null; max_price: number | null
  median_price: number | null; avg_price: number | null
  last_sold_price: number | null; last_sold_date: string
  have: number | null; want: number | null; items_for_sale: number | null
  sales_history: unknown[]; market_listings: unknown[]
}

// Chiede all'estensione di scrapare una release. Risolve coi dati scrapati.
export function scrapeReleaseViaExtension(releaseId: string, timeoutMs = 90000): Promise<ScrapedSales> {
  return new Promise((resolve, reject) => {
    if (!extPresent) { reject(new Error('Estensione non rilevata')); return }
    const reqId = Math.random().toString(36).slice(2)
    const handler = (e: MessageEvent) => {
      if (e.source !== window || !e.data || !e.data.__posmanager_resp || e.data.reqId !== reqId) return
      window.removeEventListener('message', handler)
      clearTimeout(timer)
      if (e.data.error) reject(new Error(e.data.error))
      else resolve(e.data.data)
    }
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error('Timeout scraping (Discogs/Cloudflare?)'))
    }, timeoutMs)
    window.addEventListener('message', handler)
    window.postMessage({ __posmanager: true, action: 'scrape', release_id: releaseId, reqId }, '*')
  })
}
