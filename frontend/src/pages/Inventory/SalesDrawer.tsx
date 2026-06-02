import { useQuery } from '@tanstack/react-query'
import { Drawer, Spin, Empty, Row, Col, Card, Table, Tag, Typography, Statistic, Tooltip } from 'antd'
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

// ── Grafico scatter SVG (prezzo nel tempo) ──────────────────────────────────────
function SalesChart({ sales, myPrice }: { sales: Sale[]; myPrice?: number }) {
  if (!sales.length) return <Empty description="Nessuna vendita storica" />
  const W = 560, H = 220, pad = 40
  const pts = sales
    .map(s => ({ t: dayjs(s.date).valueOf(), p: s.price, raw: s }))
    .filter(p => !isNaN(p.t))
    .sort((a, b) => a.t - b.t)
  if (!pts.length) return <Empty description="Date non valide" />

  const tMin = pts[0].t, tMax = pts[pts.length - 1].t || tMin + 1
  const prices = pts.map(p => p.p)
  const pMin = Math.min(...prices, myPrice ?? Infinity)
  const pMax = Math.max(...prices, myPrice ?? 0)
  const xs = (t: number) => pad + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - 2 * pad)
  const ys = (p: number) => H - pad - (pMax === pMin ? 0.5 : (p - pMin) / (pMax - pMin)) * (H - 2 * pad)

  return (
    <svg width={W} height={H} style={{ maxWidth: '100%' }}>
      {/* assi */}
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#ddd" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#ddd" />
      {/* etichette prezzo */}
      <text x={4} y={ys(pMax) + 4} fontSize="10" fill="#888">€{pMax.toFixed(0)}</text>
      <text x={4} y={ys(pMin) + 4} fontSize="10" fill="#888">€{pMin.toFixed(0)}</text>
      {/* linea mio prezzo */}
      {myPrice != null && (
        <>
          <line x1={pad} y1={ys(myPrice)} x2={W - pad} y2={ys(myPrice)}
            stroke="#e74c3c" strokeDasharray="4 3" />
          <text x={W - pad - 70} y={ys(myPrice) - 4} fontSize="10" fill="#e74c3c">
            tua €{myPrice.toFixed(2)}
          </text>
        </>
      )}
      {/* punti vendite */}
      {pts.map((p, i) => (
        <Tooltip key={i} title={`${p.raw.date} · €${p.p.toFixed(2)} · ${p.raw.media}`}>
          <circle cx={xs(p.t)} cy={ys(p.p)} r={4} fill="#1677ff" opacity={0.7} />
        </Tooltip>
      ))}
      {/* date estremi */}
      <text x={pad} y={H - pad + 14} fontSize="10" fill="#888">{dayjs(tMin).format('MM/YY')}</text>
      <text x={W - pad - 30} y={H - pad + 14} fontSize="10" fill="#888">{dayjs(tMax).format('MM/YY')}</text>
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

  const fmt = (v: number | null | undefined, cur = 'EUR') =>
    v == null ? '—' : `${cur === 'EUR' ? '€' : cur + ' '}${v.toFixed(2)}`

  const matchMine = (l: Listing) =>
    myMedia && l.media === myMedia && (!mySleeve || l.sleeve === mySleeve)

  const marketCols: ColumnType<Listing>[] = [
    { title: 'Venditore', dataIndex: 'seller', ellipsis: true,
      render: (v: string, r: Listing) => (
        <span>
          <Link href={`https://www.discogs.com/seller/${v}/profile`} target="_blank">{v || '—'}</Link>
          {r.feedback_pct && <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
            {r.feedback_pct}{r.feedback_count ? ` · ${r.feedback_count}` : ''}
          </Text>}
        </span>
      )},
    { title: 'Paese', dataIndex: 'ship_from', width: 90, ellipsis: true },
    { title: 'Media', dataIndex: 'media', width: 110, ellipsis: true },
    { title: 'Sleeve', dataIndex: 'sleeve', width: 110, ellipsis: true },
    { title: 'Prezzo', dataIndex: 'price', width: 80, align: 'right' as const,
      render: (v: number, r: Listing) => fmt(v, r.currency) },
    { title: '+Sped', dataIndex: 'shipping', width: 70, align: 'right' as const,
      render: (v: number, r: Listing) => fmt(v, r.currency) },
    { title: 'Totale', dataIndex: 'total', width: 80, align: 'right' as const,
      render: (v: number, r: Listing) => <b>{fmt(v, r.currency)}</b> },
  ]

  return (
    <Drawer
      open={!!releaseId}
      onClose={onClose}
      width={720}
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
          {/* Statistiche */}
          <Row gutter={8} style={{ marginBottom: 12 }}>
            <Col span={6}><Card size="small"><Statistic title="Vendite" value={data.sales_count} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="In vendita" value={data.items_for_sale ?? 0} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="Have" value={data.have ?? '—'} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="Want" value={data.want ?? '—'} /></Card></Col>
          </Row>
          <Row gutter={8} style={{ marginBottom: 16 }}>
            <Col span={6}><Card size="small"><Statistic title="Min" value={fmt(data.min_price)} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="Mediana" value={fmt(data.median_price)} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="Media" value={fmt(data.avg_price)} /></Card></Col>
            <Col span={6}><Card size="small"><Statistic title="Max" value={fmt(data.max_price)} /></Card></Col>
          </Row>

          {/* Grafico storico */}
          <Card size="small" title="Storico prezzi vendite" style={{ marginBottom: 16 }}>
            <SalesChart sales={data.sales_history} myPrice={myPrice} />
            {data.last_sold_date && (
              <Text type="secondary">Ultima vendita: {data.last_sold_date} a {fmt(data.last_sold_price)}</Text>
            )}
          </Card>

          {/* Mercato attuale */}
          <Card size="small" title={`Copie in vendita ora (${data.market_listings.length})`}>
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
