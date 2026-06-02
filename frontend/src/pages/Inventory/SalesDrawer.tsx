import { useQuery } from '@tanstack/react-query'
import { Drawer, Spin, Empty, Row, Col, Card, Table, Typography, Statistic, Tooltip } from 'antd'
import type { ColumnType } from 'antd/es/table'
import client from '@/api/client'
import dayjs from 'dayjs'

const { Text, Link } = Typography

interface Sale { date: string; media: string; sleeve: string; price: number; currency: string }
interface Listing {
  seller: string; feedback_pct: string; feedback_count: number | null
  ship_from: string; media: string; sleeve: string
  price: number | null; shipping: number | null; total: number | null; currency: string
}
interface SalesData {
  scraped: boolean
  release_id: string
  sales_count: number
  min_price: number | null; max_price: number | null
  median_price: number | null; avg_price: number | null
  last_sold_price: number | null; last_sold_date: string
  have: number | null; want: number | null; items_for_sale: number | null
  sales_history: Sale[]
  market_listings: Listing[]
  sales_scraped_at: string | null
}

interface Props {
  releaseId: string | null
  myMedia?: string
  mySleeve?: string
  myPrice?: number
  title?: string
  onClose: () => void
}

// ── Valuta ──────────────────────────────────────────────────────────────────
const CUR_SYM: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', CAD: 'CA$', JPY: '¥' }
function money(v: number | null | undefined, cur = 'EUR'): string {
  if (v == null) return '—'
  const s = CUR_SYM[cur] ?? (cur + ' ')
  return `${s}${v.toFixed(2)}`
}

// ── Bandiera + sigla paese ───────────────────────────────────────────────────
const COUNTRY_CODE: Record<string, string> = {
  'Italy': 'IT', 'Germany': 'DE', 'United Kingdom': 'GB', 'United States': 'US',
  'France': 'FR', 'Spain': 'ES', 'Netherlands': 'NL', 'Belgium': 'BE',
  'Ireland': 'IE', 'Portugal': 'PT', 'Austria': 'AT', 'Switzerland': 'CH',
  'Sweden': 'SE', 'Norway': 'NO', 'Denmark': 'DK', 'Finland': 'FI',
  'Poland': 'PL', 'Greece': 'GR', 'Japan': 'JP', 'Canada': 'CA',
  'Australia': 'AU', 'Czech Republic': 'CZ', 'Czechia': 'CZ', 'Hungary': 'HU',
  'Romania': 'RO', 'Russia': 'RU', 'Brazil': 'BR', 'Mexico': 'MX',
  'Slovenia': 'SI', 'Slovakia': 'SK', 'Croatia': 'HR', 'Ukraine': 'UA',
  'Lithuania': 'LT', 'Latvia': 'LV', 'Estonia': 'EE', 'Luxembourg': 'LU',
}
function flag(country: string): string {
  if (!country) return ''
  const code = COUNTRY_CODE[country.trim()] ?? country.trim().slice(0, 2).toUpperCase()
  if (code.length !== 2) return ''
  return String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}
function countryShort(country: string): string {
  return COUNTRY_CODE[country?.trim()] ?? (country || '').slice(0, 3).toUpperCase()
}

// ── Grafico storico prezzi (linea + punti, ultima vendita evidenziata) ─────────
function SalesChart({ sales, myPrice }: { sales: Sale[]; myPrice?: number }) {
  if (!sales.length) return <Empty description="Nessuna vendita storica" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  const W = 640, H = 260, padL = 48, padR = 60, padB = 28, padT = 16
  const pts = sales
    .map(s => ({ t: dayjs(s.date).valueOf(), p: s.price, raw: s }))
    .filter(p => !isNaN(p.t))
    .sort((a, b) => a.t - b.t)
  if (!pts.length) return <Empty description="Date non valide" />

  const tMin = pts[0].t, tMax = pts[pts.length - 1].t
  const allP = pts.map(p => p.p).concat(myPrice != null ? [myPrice] : [])
  const pMin = Math.min(...allP), pMax = Math.max(...allP)
  const xs = (t: number) => padL + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - padL - padR)
  const ys = (p: number) => H - padB - (pMax === pMin ? 0.5 : (p - pMin) / (pMax - pMin)) * (H - padT - padB)

  const gridP = [pMin, (pMin + pMax) / 2, pMax]
  const line = pts.map(p => `${xs(p.t)},${ys(p.p)}`).join(' ')
  const last = pts[pts.length - 1]

  return (
    <svg width={W} height={H} style={{ maxWidth: '100%' }}>
      {/* gridlines + label prezzo */}
      {gridP.map((gp, i) => (
        <g key={i}>
          <line x1={padL} y1={ys(gp)} x2={W - padR} y2={ys(gp)} stroke="#eee" />
          <text x={4} y={ys(gp) + 4} fontSize="11" fill="#999">€{gp.toFixed(0)}</text>
        </g>
      ))}
      {/* linea mio prezzo */}
      {myPrice != null && (
        <>
          <line x1={padL} y1={ys(myPrice)} x2={W - padR} y2={ys(myPrice)}
            stroke="#e74c3c" strokeWidth={1.5} strokeDasharray="5 3" />
          <text x={W - padR + 4} y={ys(myPrice) + 4} fontSize="11" fill="#e74c3c" fontWeight="bold">
            tua €{myPrice.toFixed(0)}
          </text>
        </>
      )}
      {/* linea andamento */}
      <polyline points={line} fill="none" stroke="#1677ff" strokeWidth={1.5} opacity={0.5} />
      {/* punti */}
      {pts.map((p, i) => (
        <Tooltip key={i} title={`${p.raw.date} · €${p.p.toFixed(2)} · ${p.raw.media}`}>
          <circle cx={xs(p.t)} cy={ys(p.p)} r={3.5} fill="#1677ff" opacity={0.75} />
        </Tooltip>
      ))}
      {/* ultima vendita evidenziata */}
      <circle cx={xs(last.t)} cy={ys(last.p)} r={6} fill="#27ae60" stroke="#fff" strokeWidth={2} />
      <text x={xs(last.t)} y={ys(last.p) - 10} fontSize="11" fill="#27ae60" fontWeight="bold" textAnchor="middle">
        €{last.p.toFixed(0)}
      </text>
      {/* date estremi */}
      <text x={padL} y={H - 8} fontSize="11" fill="#999">{dayjs(tMin).format('MM/YYYY')}</text>
      <text x={W - padR} y={H - 8} fontSize="11" fill="#999" textAnchor="end">{dayjs(tMax).format('MM/YYYY')}</text>
    </svg>
  )
}

export default function SalesDrawer({ releaseId, myMedia, mySleeve, myPrice, title, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['release-sales', releaseId],
    queryFn: async () => {
      const res = await client.get(`/api/v1/inventory/releases/${releaseId}/sales`)
      return res.data as SalesData
    },
    enabled: !!releaseId,
  })

  const matchMine = (l: Listing) =>
    !!myMedia && l.media === myMedia && (!mySleeve || l.sleeve === mySleeve)

  const marketCols: ColumnType<Listing>[] = [
    {
      title: 'Venditore', dataIndex: 'seller', ellipsis: true,
      render: (v: string, r: Listing) => (
        <div style={{ lineHeight: 1.25 }}>
          <Link href={`https://www.discogs.com/seller/${v}/profile`} target="_blank">{v || '—'}</Link>
          {(r.feedback_pct || r.feedback_count != null) && (
            <div style={{ fontSize: 11, color: '#888' }}>
              {r.feedback_count != null ? `${r.feedback_count} fb` : ''}{r.feedback_pct ? ` · ${r.feedback_pct}` : ''}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Paese', dataIndex: 'ship_from', width: 80, align: 'center' as const,
      render: (v: string) => (
        <Tooltip title={v}><span>{flag(v)} {countryShort(v)}</span></Tooltip>
      ),
    },
    { title: 'Media', dataIndex: 'media', width: 115, ellipsis: true },
    { title: 'Sleeve', dataIndex: 'sleeve', width: 115, ellipsis: true },
    {
      title: 'Prezzo', key: 'price', width: 95, align: 'right' as const,
      render: (_: unknown, r: Listing) => (
        <div style={{ lineHeight: 1.2 }}>
          <div>{money(r.price, r.currency)}</div>
          {r.shipping != null && (
            <div style={{ fontSize: 11, color: '#aaa' }}>+{money(r.shipping, r.currency)}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Totale', dataIndex: 'total', width: 90, align: 'right' as const,
      render: (v: number, r: Listing) => <b>{money(v, r.currency)}</b>,
    },
  ]

  return (
    <Drawer
      open={!!releaseId}
      onClose={onClose}
      width={760}
      title={<span>📊 Vendite & Mercato {title ? `— ${title}` : `release ${releaseId}`}</span>}
    >
      {isLoading && <Spin />}
      {!isLoading && data && !data.scraped && (
        <Empty description={
          <span>Nessun dato vendita per questa release.<br />
            <Text type="secondary">Lancia lo scraper locale: <code>python discogs_scrape_local.py {releaseId}</code></Text>
          </span>
        } />
      )}
      {!isLoading && data && data.scraped && (
        <>
          {/* STATISTICS */}
          <Card size="small" title="Statistics" style={{ marginBottom: 12 }}>
            <Row gutter={8}>
              <Col span={4}><Statistic title="Vendite" value={data.sales_count} /></Col>
              <Col span={4}><Statistic title="In vendita" value={data.items_for_sale ?? 0} /></Col>
              <Col span={4}><Statistic title="Have" value={data.have ?? '—'} /></Col>
              <Col span={4}><Statistic title="Want" value={data.want ?? '—'} /></Col>
              <Col span={4}><Statistic title="Ultima" value={data.last_sold_price != null ? `€${data.last_sold_price.toFixed(0)}` : '—'} /></Col>
              <Col span={4}><Statistic title="Data" value={data.last_sold_date || '—'} valueStyle={{ fontSize: 13 }} /></Col>
            </Row>
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={6}><Statistic title="Min" value={money(data.min_price)} valueStyle={{ fontSize: 16 }} /></Col>
              <Col span={6}><Statistic title="Mediana" value={money(data.median_price)} valueStyle={{ fontSize: 16 }} /></Col>
              <Col span={6}><Statistic title="Media" value={money(data.avg_price)} valueStyle={{ fontSize: 16 }} /></Col>
              <Col span={6}><Statistic title="Max" value={money(data.max_price)} valueStyle={{ fontSize: 16 }} /></Col>
            </Row>
          </Card>

          {/* GRAFICO */}
          <Card size="small" title="Storico prezzi vendite" style={{ marginBottom: 12 }}>
            <SalesChart sales={data.sales_history} myPrice={myPrice} />
          </Card>

          {/* MERCATO */}
          <Card size="small" title={`Copie in vendita ora (${data.market_listings.length}) — ordine: listed più recenti`}>
            {myMedia && (
              <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                🟩 evidenziate le copie pari alla tua ({myMedia}{mySleeve ? ` / ${mySleeve}` : ''})
              </Text>
            )}
            <Table
              dataSource={data.market_listings}
              columns={marketCols}
              rowKey={(_, i) => String(i)}
              size="small"
              pagination={false}
              rowClassName={(r) => matchMine(r) ? 'row-match-mine' : ''}
            />
          </Card>

          {data.sales_scraped_at && (
            <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
              Dati aggiornati: {dayjs(data.sales_scraped_at).format('DD/MM/YYYY HH:mm')}
            </Text>
          )}
        </>
      )}
      <style>{`.row-match-mine td { background: #f6ffed !important; }`}</style>
    </Drawer>
  )
}
