import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Table, Input, Tabs, Tag, Button, message, Alert, Select, Progress, Tooltip } from 'antd'
import type { ColumnType } from 'antd/es/table'
import { PlusOutlined, SearchOutlined, SyncOutlined, ClearOutlined, DatabaseOutlined, LineChartOutlined } from '@ant-design/icons'
import client from '@/api/client'
import AddInventoryModal from './AddInventoryModal'
import SalesDrawer from './SalesDrawer'

type Row = Record<string, string>

interface FacetItem { value: string; count: number; label?: string; min?: number; max?: number }
interface Facets {
  media_types: FacetItem[]
  format_desc: FacetItem[]
  price_ranges: FacetItem[]
  media_conditions: FacetItem[]
  sleeve_conditions: FacetItem[]
  locations: FacetItem[]
  genres: FacetItem[]
  styles: FacetItem[]
  years: FacetItem[]
}

interface FilterState {
  media_type?: string
  format_desc?: string
  media_condition?: string
  sleeve_condition?: string
  location?: string
  genre?: string
  style?: string
  year?: string
  price_range?: string  // chiave del range, es "5to10"
}

function formatPrice(v: string): string {
  const n = parseFloat(v)
  if (isNaN(n)) return v || '—'
  return `€ ${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

function formatDate(v: string): string {
  if (!v) return '—'
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return v.split(' ')[0]
}

const groupedColumns: ColumnType<Row>[] = [
  { title: 'Fonte', dataIndex: 'source', width: 75, render: (v: string) => <Tag>{v}</Tag> },
  {
    title: 'Articolo', key: 'articolo',
    render: (_: unknown, r: Row) => (
      <div style={{ lineHeight: 1.35 }}>
        <div style={{ fontWeight: 600 }}>{r.artist || '—'}{r.title ? ` — ${r.title}` : ''}</div>
        <div style={{ fontSize: 12, color: '#888' }}>
          {[r.label, r.catno, r.format].filter(Boolean).join(' · ') || '—'}
        </div>
        {(r.genre || r.year) && (
          <div style={{ fontSize: 11, color: '#aaa' }}>
            {[r.genre, r.style, r.year].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    ),
  },
  {
    title: 'Prezzo / Condizioni', key: 'prezzo', width: 200,
    render: (_: unknown, r: Row) => (
      <div style={{ lineHeight: 1.35 }}>
        <div>
          <b style={{ color: '#27ae60' }}>{formatPrice(r.price)}</b>
          <span style={{ color: '#aaa', marginLeft: 8, fontSize: 12 }}>{formatDate(r.listed)}</span>
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>
          M: {r.media_condition || '—'} · S: {r.sleeve_condition || '—'}
        </div>
      </div>
    ),
  },
  {
    title: 'Location / Note', key: 'location', width: 190,
    render: (_: unknown, r: Row) => (
      <div style={{ lineHeight: 1.35 }}>
        {r.location && <div style={{ fontWeight: 600, color: '#1677ff' }}>📍 {r.location}</div>}
        {r.comments && <div style={{ fontSize: 12, color: '#888' }}>{r.comments}</div>}
        {!r.location && !r.comments && <span style={{ color: '#ccc' }}>—</span>}
      </div>
    ),
  },
  { title: 'ID', dataIndex: 'listing_id', width: 95, render: (v: string) => <span style={{ fontSize: 11, color: '#999' }}>{v}</span> },
]

async function getInventory(status: string, q: string, filters: FilterState, sort: string, page: number, facets?: Facets) {
  const params: Record<string, unknown> = { status, page, page_size: 100, sort }
  if (q) params.q = q
  if (filters.media_type) params.media_type = filters.media_type
  if (filters.format_desc) params.format_desc = filters.format_desc
  if (filters.media_condition) params.media_condition = filters.media_condition
  if (filters.sleeve_condition) params.sleeve_condition = filters.sleeve_condition
  if (filters.location) params.location = filters.location
  if (filters.genre) params.genre = filters.genre
  if (filters.style) params.style = filters.style
  if (filters.year) params.year = filters.year
  if (filters.price_range && facets) {
    const pr = facets.price_ranges.find(p => p.value === filters.price_range)
    if (pr) { params.price_min = pr.min; params.price_max = pr.max }
  }
  const res = await client.get('/api/v1/inventory', { params })
  return res.data
}

async function getFacets(status: string, q: string): Promise<Facets> {
  const res = await client.get('/api/v1/inventory/facets', { params: { status, q: q || undefined } })
  return res.data
}

function opts(items: FacetItem[]) {
  return items.map(i => ({ value: i.value, label: `${i.label ?? i.value} (${i.count})` }))
}

function InventoryTable({ status }: { status: string }) {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<FilterState>({})
  const [sort, setSort] = useState('listed_desc')
  const [page, setPage] = useState(1)
  const [salesRow, setSalesRow] = useState<Row | null>(null)

  const { data: facets } = useQuery({
    queryKey: ['inv-facets', status, search],
    queryFn: () => getFacets(status, search),
    staleTime: 60_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', status, search, filters, sort, page],
    queryFn: () => getInventory(status, search, filters, sort, page, facets),
  })

  const items: Row[] = data?.items ?? []

  // Colonna azione "Vendite & Mercato" (solo se l'articolo ha release_id)
  const columns: ColumnType<Row>[] = [
    ...groupedColumns,
    {
      title: '', key: 'sales', width: 48, align: 'center' as const,
      render: (_: unknown, r: Row) => r.release_id ? (
        <Tooltip title="Vendite & Mercato">
          <Button size="small" type="text" icon={<LineChartOutlined />}
            onClick={(e) => { e.stopPropagation(); setSalesRow(r) }} />
        </Tooltip>
      ) : null,
    },
  ]

  const setF = (k: keyof FilterState, v?: string) => { setFilters(p => ({ ...p, [k]: v })); setPage(1) }
  const clearAll = () => { setFilters({}); setSearch(''); setPage(1) }
  const activeCount = Object.values(filters).filter(Boolean).length + (search ? 1 : 0)

  const selStyle = { minWidth: 130 }

  return (
    <div>
      {/* Barra ricerca + sort */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Input
          placeholder="Cerca artista, titolo, cat#..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          style={{ width: 280 }}
          allowClear
        />
        <Select
          value={sort}
          onChange={(v) => { setSort(v); setPage(1) }}
          style={{ width: 170 }}
          options={[
            { value: 'listed_desc', label: '↓ Listed recenti' },
            { value: 'listed_asc', label: '↑ Listed vecchi' },
            { value: 'price_desc', label: '↓ Prezzo alto' },
            { value: 'price_asc', label: '↑ Prezzo basso' },
            { value: 'artist_asc', label: 'Artista A-Z' },
            { value: 'title_asc', label: 'Titolo A-Z' },
          ]}
        />
        <span style={{ lineHeight: '32px', color: '#888' }}>{data?.total ?? 0} articoli</span>
        {activeCount > 0 && (
          <Button icon={<ClearOutlined />} onClick={clearAll} size="middle">
            Azzera filtri ({activeCount})
          </Button>
        )}
      </div>

      {/* Barra facet */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <Select placeholder="Format" style={selStyle} allowClear showSearch
          value={filters.media_type} onChange={(v) => setF('media_type', v)}
          options={opts(facets?.media_types ?? [])} />
        <Select placeholder="Descrizione" style={selStyle} allowClear showSearch
          value={filters.format_desc} onChange={(v) => setF('format_desc', v)}
          options={opts(facets?.format_desc ?? [])} />
        <Select placeholder="Prezzo" style={selStyle} allowClear
          value={filters.price_range} onChange={(v) => setF('price_range', v)}
          options={opts(facets?.price_ranges ?? [])} />
        <Select placeholder="Genere" style={selStyle} allowClear showSearch
          value={filters.genre} onChange={(v) => setF('genre', v)}
          options={opts(facets?.genres ?? [])} />
        <Select placeholder="Stile" style={selStyle} allowClear showSearch
          value={filters.style} onChange={(v) => setF('style', v)}
          options={opts(facets?.styles ?? [])} />
        <Select placeholder="Anno" style={{ minWidth: 100 }} allowClear showSearch
          value={filters.year} onChange={(v) => setF('year', v)}
          options={opts(facets?.years ?? [])} />
        <Select placeholder="Media Cond." style={selStyle} allowClear showSearch
          value={filters.media_condition} onChange={(v) => setF('media_condition', v)}
          options={opts(facets?.media_conditions ?? [])} />
        <Select placeholder="Sleeve" style={selStyle} allowClear showSearch
          value={filters.sleeve_condition} onChange={(v) => setF('sleeve_condition', v)}
          options={opts(facets?.sleeve_conditions ?? [])} />
        <Select placeholder="Location" style={selStyle} allowClear showSearch
          value={filters.location} onChange={(v) => setF('location', v)}
          options={opts(facets?.locations ?? [])} />
      </div>

      <Table
        dataSource={items}
        columns={columns}
        rowKey={(r) => `${r.source}-${r.listing_id}`}
        loading={isLoading}
        size="small"
        pagination={{ current: page, total: data?.total ?? 0, pageSize: 100, onChange: setPage }}
      />

      <SalesDrawer
        releaseId={salesRow?.release_id || null}
        myMedia={salesRow?.media_condition}
        mySleeve={salesRow?.sleeve_condition}
        myPrice={salesRow ? parseFloat(salesRow.price) || undefined : undefined}
        myLocation={salesRow?.location}
        myExternalId={salesRow?.external_id}
        myComments={salesRow?.comments}
        title={salesRow ? `${salesRow.artist} — ${salesRow.title}` : undefined}
        onClose={() => setSalesRow(null)}
      />
    </div>
  )
}

const tabItems = [
  { key: 'For Sale', label: '🟢 For Sale', children: <InventoryTable status="For Sale" /> },
  { key: 'Draft', label: '🟡 Draft', children: <InventoryTable status="Draft" /> },
  { key: 'Sold', label: '⚫ Sold', children: <InventoryTable status="Sold" /> },
]

export default function InventoryPage() {
  const [syncing, setSyncing] = useState(false)
  const [syncInfo, setSyncInfo] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [enrichProg, setEnrichProg] = useState<{ enriched: number; total: number; running: boolean } | null>(null)
  const [extPresent, setExtPresent] = useState(false)
  const qc = useQueryClient()

  // Rilevamento estensione Chrome (il bridge annuncia la sua presenza)
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source === window && e.data && e.data.__posmanager_ext) setExtPresent(true)
    }
    window.addEventListener('message', h)
    return () => window.removeEventListener('message', h)
  }, [])


  const handleSync = async () => {
    setSyncing(true); setSyncInfo(null)
    try {
      const res = await client.post('/api/v1/inventory/sync')
      setSyncInfo(`✅ ${res.data.rows} articoli scaricati (${res.data.filename})`)
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inv-facets'] })
    } catch {
      message.error('Errore durante il sync con Discogs.')
    } finally { setSyncing(false) }
  }

  // Polling stato arricchimento (il task gira sul server, autonomo)
  const fetchEnrichStatus = async () => {
    try {
      const r = await client.get('/api/v1/inventory/enrich-status')
      setEnrichProg({ enriched: r.data.enriched, total: r.data.total, running: r.data.running })
      return r.data
    } catch { return null }
  }

  useEffect(() => {
    fetchEnrichStatus()
    const id = setInterval(async () => {
      const s = await fetchEnrichStatus()
      if (s && !s.running) {
        // aggiorna i dati quando finisce
        qc.invalidateQueries({ queryKey: ['inventory'] })
        qc.invalidateQueries({ queryKey: ['inv-facets'] })
      }
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const handleEnrichStart = async () => {
    try {
      const r = await client.post('/api/v1/inventory/enrich-start')
      if (r.data.already_running) message.info('Arricchimento già in corso')
      else message.success('Arricchimento avviato sul server (continua anche se chiudi il browser)')
      fetchEnrichStatus()
    } catch {
      message.error('Errore avvio arricchimento')
    }
  }

  const handleEnrichStop = async () => {
    await client.post('/api/v1/inventory/enrich-stop')
    message.info('Arricchimento in arresto…')
  }

  const running = enrichProg?.running
  const pct = enrichProg && enrichProg.total ? Math.round(enrichProg.enriched / enrichProg.total * 100) : 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>📦 Inventario</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add Inventory</Button>
        <Button icon={<SyncOutlined spin={syncing} />} onClick={handleSync} loading={syncing}>
          {syncing ? 'Download da Discogs...' : 'Aggiorna da Discogs'}
        </Button>
        <Tooltip title="Scarica i metadati completi da Discogs (gira sul server, autonomo)">
          <Button icon={<DatabaseOutlined />} onClick={handleEnrichStart} disabled={running}>
            {running ? 'Arricchimento in corso…' : 'Arricchisci metadati'}
          </Button>
        </Tooltip>
        {running && <Button danger size="small" onClick={handleEnrichStop}>Stop</Button>}
        {enrichProg && (enrichProg.enriched < enrichProg.total || running) && (
          <span style={{ minWidth: 220 }}>
            <Progress percent={pct} size="small" status={running ? 'active' : 'normal'}
              format={() => `${enrichProg.enriched}/${enrichProg.total}`} />
          </span>
        )}
        {extPresent && (
          <Tooltip title="Estensione Chrome rilevata: i dati di mercato si scaricano aprendo 📊 su un articolo">
            <Tag color="green">🧩 Estensione attiva</Tag>
          </Tooltip>
        )}
      </div>

      {syncInfo && (
        <Alert message={syncInfo} type="success" showIcon closable
          style={{ marginBottom: 12 }} onClose={() => setSyncInfo(null)} />
      )}

      <Tabs items={tabItems} size="large" />

      <AddInventoryModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['inventory'] }) }}
      />
    </div>
  )
}
