import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Drawer, Spin, Empty, Row, Col, Card, Table, Typography, Statistic, Tooltip,
  Tag, Image, Collapse, Descriptions, Divider, Button, message,
} from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import type { ColumnType } from 'antd/es/table'
import client from '@/api/client'
import { isExtensionPresent, scrapeReleaseViaExtension } from '@/api/extScraper'
import dayjs from 'dayjs'

const { Text, Link, Title } = Typography

// ── Tipi ──────────────────────────────────────────────────────────────────────
interface Sale { date: string; media: string; sleeve: string; price: number; currency: string }
interface Listing {
  seller: string; feedback_pct: string; feedback_count: number | null
  ship_from: string; media: string; sleeve: string; comments?: string
  price: number | null; shipping: number | null; total: number | null; currency: string
}
interface SalesData {
  scraped: boolean; release_id: string; sales_count: number
  min_price: number | null; max_price: number | null; median_price: number | null; avg_price: number | null
  last_sold_price: number | null; last_sold_date: string
  have: number | null; want: number | null; items_for_sale: number | null
  sales_history: Sale[]; market_listings: Listing[]; sales_scraped_at: string | null
}
interface MetaData {
  found: boolean
  artist: string; title: string; label: string; catno: string; format: string
  year: string; country: string; released: string; genre: string; style: string
  barcode: string; master_id: string; thumbnail: string; cover_image: string
  have: number | null; want: number | null; rating_avg: number | null; rating_count: number | null
  num_for_sale: number | null; lowest_price: number | null; notes: string
  tracklist: { position: string; title: string; duration: string }[]
  images: { uri: string; thumb: string }[]
  videos: { uri: string; title: string }[]
}

interface Props {
  releaseId: string | null
  myMedia?: string; mySleeve?: string; myPrice?: number; myLocation?: string
  title?: string
  onClose: () => void
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const CUR_SYM: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', JPY: '¥' }
const money = (v: number | null | undefined, cur = 'EUR') =>
  v == null ? '—' : `${CUR_SYM[cur] ?? cur + ' '}${v.toFixed(2)}`

const COUNTRY_CODE: Record<string, string> = {
  'Italy': 'IT', 'Germany': 'DE', 'United Kingdom': 'GB', 'UK': 'GB', 'United States': 'US', 'US': 'US',
  'France': 'FR', 'Spain': 'ES', 'Netherlands': 'NL', 'Belgium': 'BE', 'Ireland': 'IE', 'Portugal': 'PT',
  'Austria': 'AT', 'Switzerland': 'CH', 'Sweden': 'SE', 'Norway': 'NO', 'Denmark': 'DK', 'Finland': 'FI',
  'Poland': 'PL', 'Greece': 'GR', 'Japan': 'JP', 'Canada': 'CA', 'Australia': 'AU', 'Czech Republic': 'CZ',
}
const flag = (c: string) => {
  if (!c) return ''
  const code = COUNTRY_CODE[c.trim()] ?? c.trim().slice(0, 2).toUpperCase()
  if (code.length !== 2) return ''
  return String.fromCodePoint(...[...code].map(x => 0x1f1e6 + x.charCodeAt(0) - 65))
}
const countryShort = (c: string) => COUNTRY_CODE[c?.trim()] ?? (c || '').slice(0, 3).toUpperCase()
// "Very Good Plus (VG+)" → "VG+"; "Generic" → "Generic"
const abbr = (cond: string) => { const m = (cond || '').match(/\(([^)]+)\)/); return m ? m[1] : (cond || '—') }

// ── Grafico storico prezzi ──────────────────────────────────────────────────
function SalesChart({ sales, myPrice }: { sales: Sale[]; myPrice?: number }) {
  if (!sales.length) return <Empty description="Nessuna vendita storica" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  const W = 640, H = 240, padL = 48, padR = 60, padB = 26, padT = 14
  const pts = sales.map(s => ({ t: dayjs(s.date).valueOf(), p: s.price, raw: s }))
    .filter(p => !isNaN(p.t)).sort((a, b) => a.t - b.t)
  if (!pts.length) return <Empty description="Date non valide" />
  const tMin = pts[0].t, tMax = pts[pts.length - 1].t
  const allP = pts.map(p => p.p).concat(myPrice != null ? [myPrice] : [])
  const pMin = Math.min(...allP), pMax = Math.max(...allP)
  const xs = (t: number) => padL + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - padL - padR)
  const ys = (p: number) => H - padB - (pMax === pMin ? 0.5 : (p - pMin) / (pMax - pMin)) * (H - padT - padB)
  const line = pts.map(p => `${xs(p.t)},${ys(p.p)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={W} height={H} style={{ maxWidth: '100%' }}>
      {[pMin, (pMin + pMax) / 2, pMax].map((gp, i) => (
        <g key={i}>
          <line x1={padL} y1={ys(gp)} x2={W - padR} y2={ys(gp)} stroke="#eee" />
          <text x={4} y={ys(gp) + 4} fontSize="11" fill="#999">€{gp.toFixed(0)}</text>
        </g>
      ))}
      {myPrice != null && (<>
        <line x1={padL} y1={ys(myPrice)} x2={W - padR} y2={ys(myPrice)} stroke="#e74c3c" strokeWidth={1.5} strokeDasharray="5 3" />
        <text x={W - padR + 4} y={ys(myPrice) + 4} fontSize="11" fill="#e74c3c" fontWeight="bold">tua €{myPrice.toFixed(0)}</text>
      </>)}
      <polyline points={line} fill="none" stroke="#1677ff" strokeWidth={1.5} opacity={0.5} />
      {pts.map((p, i) => (
        <Tooltip key={i} title={`${p.raw.date} · €${p.p.toFixed(2)} · ${p.raw.media}`}>
          <circle cx={xs(p.t)} cy={ys(p.p)} r={3.5} fill="#1677ff" opacity={0.75} />
        </Tooltip>
      ))}
      <circle cx={xs(last.t)} cy={ys(last.p)} r={6} fill="#27ae60" stroke="#fff" strokeWidth={2} />
      <text x={xs(last.t)} y={ys(last.p) - 10} fontSize="11" fill="#27ae60" fontWeight="bold" textAnchor="middle">€{last.p.toFixed(0)}</text>
      <text x={padL} y={H - 6} fontSize="11" fill="#999">{dayjs(tMin).format('MM/YYYY')}</text>
      <text x={W - padR} y={H - 6} fontSize="11" fill="#999" textAnchor="end">{dayjs(tMax).format('MM/YYYY')}</text>
    </svg>
  )
}

export default function SalesDrawer({ releaseId, myMedia, mySleeve, myPrice, myLocation, title, onClose }: Props) {
  const qc = useQueryClient()
  const [scraping, setScraping] = useState(false)
  const autoTried = useRef<string | null>(null)

  const { data: meta } = useQuery({
    queryKey: ['release-meta', releaseId],
    queryFn: async () => (await client.get(`/api/v1/inventory/releases/${releaseId}/meta`)).data as MetaData,
    enabled: !!releaseId,
  })
  const { data: sales, isLoading } = useQuery({
    queryKey: ['release-sales', releaseId],
    queryFn: async () => (await client.get(`/api/v1/inventory/releases/${releaseId}/sales`)).data as SalesData,
    enabled: !!releaseId,
  })

  // Scrapa via estensione → salva sul server (col token della web app) → ricarica
  const runScrape = async () => {
    if (!releaseId) return
    if (!isExtensionPresent()) {
      message.warning('Estensione Chrome non rilevata. Installala e tieni una scheda Discogs (loggato) aperta.')
      return
    }
    setScraping(true)
    try {
      const data = await scrapeReleaseViaExtension(releaseId)
      await client.post(`/api/v1/inventory/releases/${releaseId}/sales-ingest`, data)
      await qc.invalidateQueries({ queryKey: ['release-sales', releaseId] })
      message.success('Dati mercato aggiornati')
    } catch (e) {
      message.error((e as Error).message || 'Errore scraping estensione')
    } finally { setScraping(false) }
  }

  // Auto-scrape all'apertura se mancano i dati di vendita
  useEffect(() => {
    if (!releaseId || isLoading || scraping) return
    if (sales && !sales.scraped && autoTried.current !== releaseId && isExtensionPresent()) {
      autoTried.current = releaseId
      runScrape()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseId, isLoading, sales])

  const matchMine = (l: Listing) => !!myMedia && l.media === myMedia && (!mySleeve || l.sleeve === mySleeve)

  const marketCols: ColumnType<Listing>[] = [
    {
      title: 'Venditore', dataIndex: 'seller', width: 120, ellipsis: true,
      render: (v: string, r: Listing) => (
        <div style={{ lineHeight: 1.2 }}>
          <Link href={`https://www.discogs.com/seller/${v}/profile`} target="_blank"
            style={{ fontSize: 12 }}>{v || '—'}</Link>
          {(r.feedback_pct || r.feedback_count != null) && (
            <div style={{ fontSize: 10, color: '#999' }}>
              {r.feedback_count != null ? `${r.feedback_count}` : ''}{r.feedback_pct ? ` · ${r.feedback_pct}` : ''}
            </div>
          )}
        </div>
      ),
    },
    { title: 'Paese', dataIndex: 'ship_from', width: 70, align: 'center' as const,
      render: (v: string) => <Tooltip title={v}><span>{flag(v)} {countryShort(v)}</span></Tooltip> },
    {
      title: 'Cond.', key: 'cond', width: 90,
      render: (_: unknown, r: Listing) => (
        <Tooltip title={`Media: ${r.media} · Sleeve: ${r.sleeve}`}>
          <b>{abbr(r.media)}</b> <span style={{ color: '#bbb' }}>|</span> {abbr(r.sleeve)}
        </Tooltip>
      ),
    },
    {
      title: 'Note', dataIndex: 'comments', ellipsis: true,
      render: (v: string) => v
        ? <Tooltip title={v}><span style={{ fontSize: 11, color: '#888' }}>{v}</span></Tooltip>
        : <span style={{ color: '#ddd' }}>—</span>,
    },
    { title: 'Prezzo', key: 'price', width: 90, align: 'right' as const,
      render: (_: unknown, r: Listing) => (
        <div style={{ lineHeight: 1.2 }}>
          <div>{money(r.price, r.currency)}</div>
          {r.shipping != null && <div style={{ fontSize: 11, color: '#aaa' }}>+{money(r.shipping, r.currency)}</div>}
        </div>
      ) },
    { title: 'Totale', dataIndex: 'total', width: 88, align: 'right' as const,
      render: (v: number, r: Listing) => <b>{money(v, r.currency)}</b> },
  ]

  const hasMeta = meta && meta.found

  return (
    <Drawer open={!!releaseId} onClose={onClose} width={820}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>📊 Vendite & Mercato {title ? `— ${title}` : `release ${releaseId}`}</span>
          <Button size="small" icon={<SyncOutlined spin={scraping} />} onClick={runScrape} loading={scraping}>
            Aggiorna mercato
          </Button>
        </div>
      }>
      {scraping && (
        <div style={{ marginBottom: 12 }}>
          <Spin size="small" /> <Text type="secondary">Scraping mercato in corso via estensione…</Text>
        </div>
      )}

      {/* ── 1. RELEASE (enrichment API) ── */}
      {hasMeta && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {meta.images?.length ? (
              <Image.PreviewGroup>
                <Image src={meta.images[0].thumb} width={110} height={110}
                  style={{ objectFit: 'cover', borderRadius: 6 }} preview={{ src: meta.images[0].uri }} />
                {meta.images.slice(1).map((im, i) =>
                  <Image key={i} src={im.thumb} style={{ display: 'none' }} preview={{ src: im.uri }} />)}
              </Image.PreviewGroup>
            ) : <div style={{ width: 110, height: 110, background: '#f0f0f0', borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>🎵</div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Title level={5} style={{ margin: 0 }}>{meta.artist} — {meta.title}</Title>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
                {[meta.label, meta.catno, meta.format].filter(Boolean).join(' · ')}
              </div>
              <Descriptions size="small" column={3}
                items={[
                  { key: 'y', label: 'Anno', children: meta.year || '—' },
                  { key: 'c', label: 'Paese', children: meta.country ? `${flag(meta.country)} ${meta.country}` : '—' },
                  { key: 'b', label: 'Barcode', children: meta.barcode || '—' },
                  { key: 'h', label: 'Have', children: meta.have ?? '—' },
                  { key: 'w', label: 'Want', children: meta.want ?? '—' },
                  { key: 'r', label: 'Rating', children: meta.rating_avg ? `${meta.rating_avg}★ (${meta.rating_count})` : '—' },
                ]} />
              <div style={{ marginTop: 6 }}>
                {meta.genre && meta.genre.split(',').map(g => <Tag key={g} color="blue">{g.trim()}</Tag>)}
                {meta.style && meta.style.split(',').map(s => <Tag key={s}>{s.trim()}</Tag>)}
              </div>
            </div>
          </div>
          {(meta.tracklist?.length > 0 || meta.videos?.length > 0) && (
            <Collapse ghost size="small" style={{ marginTop: 8 }}
              items={[
                ...(meta.tracklist?.length ? [{
                  key: 'tl', label: `Tracklist (${meta.tracklist.length})`,
                  children: <div>{meta.tracklist.map((t, i) =>
                    <div key={i} style={{ fontSize: 12 }}>
                      <b>{t.position}</b> {t.title} {t.duration && <span style={{ color: '#aaa' }}>· {t.duration}</span>}
                    </div>)}</div>,
                }] : []),
                ...(meta.videos?.length ? [{
                  key: 'vid', label: `Video (${meta.videos.length})`,
                  children: <div>{meta.videos.map((v, i) =>
                    <div key={i}><Link href={v.uri} target="_blank" style={{ fontSize: 12 }}>▶ {v.title}</Link></div>)}</div>,
                }] : []),
              ]} />
          )}
        </Card>
      )}

      {/* ── 2. LA TUA COPIA (inventario) ── */}
      <Card size="small" title="🟩 La tua copia (inventario)" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={4}
          items={[
            { key: 'p', label: 'Prezzo', children: myPrice != null ? <b style={{ color: '#27ae60' }}>€{myPrice.toFixed(2)}</b> : '—' },
            { key: 'm', label: 'Media', children: myMedia || '—' },
            { key: 's', label: 'Sleeve', children: mySleeve || '—' },
            { key: 'l', label: 'Location', children: myLocation || '—' },
          ]} />
      </Card>

      {/* ── 3. VENDITE & MERCATO (scraping) ── */}
      {isLoading && <Spin />}
      {!isLoading && sales && !sales.scraped && (
        <Empty description={<span>Nessun dato vendita scrapato per questa release.<br />
          <Text type="secondary">Usa l'estensione Chrome o lo script locale.</Text></span>} />
      )}
      {!isLoading && sales && sales.scraped && (
        <>
          <Card size="small" title="Statistics (vendite Discogs)" style={{ marginBottom: 12 }}>
            <Row gutter={8}>
              <Col span={4}><Statistic title="Vendite" value={sales.sales_count} /></Col>
              <Col span={4}><Statistic title="In vendita" value={sales.items_for_sale ?? 0} /></Col>
              <Col span={4}><Statistic title="Min" value={money(sales.min_price)} valueStyle={{ fontSize: 15 }} /></Col>
              <Col span={4}><Statistic title="Mediana" value={money(sales.median_price)} valueStyle={{ fontSize: 15 }} /></Col>
              <Col span={4}><Statistic title="Media" value={money(sales.avg_price)} valueStyle={{ fontSize: 15 }} /></Col>
              <Col span={4}><Statistic title="Max" value={money(sales.max_price)} valueStyle={{ fontSize: 15 }} /></Col>
            </Row>
          </Card>

          <Card size="small" title="Storico prezzi vendite" style={{ marginBottom: 12 }}>
            <SalesChart sales={sales.sales_history} myPrice={myPrice} />
          </Card>

          <Card size="small" title={`Copie in vendita ora (${sales.market_listings.length}) — listed più recenti`}>
            {myMedia && (
              <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                🟩 evidenziate le copie pari alla tua ({myMedia}{mySleeve ? ` / ${mySleeve}` : ''})
              </Text>
            )}
            <Table dataSource={sales.market_listings} columns={marketCols}
              rowKey={(_, i) => String(i)} size="small" pagination={false}
              rowClassName={(r) => matchMine(r) ? 'row-match-mine' : ''} />
          </Card>

          {sales.sales_scraped_at && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
              Vendite aggiornate: {dayjs(sales.sales_scraped_at).format('DD/MM/YYYY HH:mm')}
            </Text>
          )}
        </>
      )}

      {!hasMeta && (
        <>
          <Divider />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Metadati release non ancora arricchiti (genere, cover, tracklist…). Lancia "Arricchisci metadati".
          </Text>
        </>
      )}

      <style>{`.row-match-mine td { background: #f6ffed !important; }`}</style>
    </Drawer>
  )
}
