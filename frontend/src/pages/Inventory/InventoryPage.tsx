import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Table, Input, InputNumber, Checkbox, Tabs, Tag, Button, message, Alert, Select, Progress, Tooltip } from 'antd'
import type { ColumnType } from 'antd/es/table'
import { PlusOutlined, SearchOutlined, SyncOutlined, ClearOutlined, DatabaseOutlined, LineChartOutlined, HistoryOutlined } from '@ant-design/icons'
import client from '@/api/client'
import AddInventoryModal from './AddInventoryModal'
import SalesDrawer from './SalesDrawer'
import HistoryDrawer from './HistoryDrawer'

type Row = Record<string, string>
type EditFn = (listingId: string, patch: Record<string, unknown>) => void

async function patchItem(listingId: string, patch: Record<string, unknown>) {
  await client.patch(`/api/v1/inventory/items/${encodeURIComponent(listingId)}`, patch)
}

// Testo libero, salva su blur solo se il valore è cambiato
function EditableText({ value, placeholder, onSave, width = 200 }: {
  value: string; placeholder?: string; onSave: (v: string) => void; width?: number
}) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return (
    <Input
      size="small"
      variant="borderless"
      value={v}
      placeholder={placeholder}
      style={{ width, fontSize: 12, padding: '0 2px' }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onSave(v) }}
      onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
    />
  )
}

// Prezzo numerico, salva su blur
function EditablePrice({ value, onSave, label = '€', color = '#27ae60', width = 78 }: {
  value: string; onSave: (v: number) => void; label?: string; color?: string; width?: number
}) {
  const [v, setV] = useState<number | undefined>(value ? parseFloat(value) : undefined)
  useEffect(() => { setV(value ? parseFloat(value) : undefined) }, [value])
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <b style={{ color, fontSize: 11 }}>{label}</b>
      <InputNumber
        size="small"
        variant="borderless"
        min={0}
        step={0.5}
        value={v}
        style={{ width, fontWeight: 600 }}
        onChange={(val) => setV(val ?? undefined)}
        onBlur={() => { if (v != null && String(v) !== value) onSave(v) }}
      />
    </span>
  )
}

// Condizione (media/sleeve), da vocabolario controllato: salva subito al cambio
function EditableCondition({ value, options, onSave, width = 118 }: {
  value: string; options: string[]; onSave: (v: string) => void; width?: number
}) {
  return (
    <Select
      size="small"
      variant="borderless"
      value={value || undefined}
      placeholder="—"
      style={{ width, fontSize: 12 }}
      options={options.map(o => ({ value: o, label: o }))}
      onChange={(v) => { if (v !== value) onSave(v) }}
    />
  )
}

interface FacetItem { value: string; count: number; label?: string; min?: number; max?: number }
interface Facets {
  sources: FacetItem[]
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
  source?: string
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

function formatDate(v: string): string {
  if (!v) return '—'
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return v.split(' ')[0]
}

function makeColumns(
  onEdit: EditFn,
  dropdownOptions?: { media_conditions: string[]; sleeve_conditions: string[] },
): ColumnType<Row>[] {
  const mediaOpts = dropdownOptions?.media_conditions ?? []
  const sleeveOpts = dropdownOptions?.sleeve_conditions ?? []

  return [
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
      title: 'Prezzo / Condizioni', key: 'prezzo', width: 260,
      render: (_: unknown, r: Row) => (
        <div style={{ lineHeight: 1.7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <EditablePrice value={r.price} onSave={(v) => onEdit(r.listing_id, { price: v })} />
            <span style={{ color: '#aaa', fontSize: 12 }}>{formatDate(r.listed)}</span>
          </div>
          <EditablePrice value={r.costo_unitario} label="Costo:" color="#888" width={70}
            onSave={(v) => onEdit(r.listing_id, { costo_unitario: v })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#888' }}>M:</span>
            <EditableCondition value={r.media_condition} options={mediaOpts}
              onSave={(v) => onEdit(r.listing_id, { media_condition: v })} />
            <span style={{ fontSize: 11, color: '#888' }}>S:</span>
            <EditableCondition value={r.sleeve_condition} options={sleeveOpts}
              onSave={(v) => onEdit(r.listing_id, { sleeve_condition: v })} />
          </div>
          <Checkbox
            checked={r.accept_offer === 'Y'}
            onChange={(e) => onEdit(r.listing_id, { accept_offer: e.target.checked ? 'Y' : 'N' })}
          >
            <span style={{ fontSize: 11, color: '#888' }}>Accetta offerte</span>
          </Checkbox>
        </div>
      ),
    },
    {
      title: 'Location / Note', key: 'location', width: 230,
      render: (_: unknown, r: Row) => (
        <div style={{ lineHeight: 1.5 }}>
          <EditableText value={r.location} placeholder="Location"
            onSave={(v) => onEdit(r.listing_id, { location: v })} />
          <EditableText value={r.comments} placeholder="Note"
            onSave={(v) => onEdit(r.listing_id, { comments: v })} />
          <EditableText value={r.external_id} placeholder="External ID"
            onSave={(v) => onEdit(r.listing_id, { external_id: v })} />
        </div>
      ),
    },
    { title: 'ID', dataIndex: 'listing_id', width: 95, render: (v: string) => <span style={{ fontSize: 11, color: '#999' }}>{v}</span> },
  ]
}

async function getInventory(status: string, q: string, filters: FilterState, sort: string, page: number, facets?: Facets) {
  const params: Record<string, unknown> = { status, page, page_size: 100, sort }
  if (q) params.q = q
  if (filters.source) params.source = filters.source
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
  const [historyRow, setHistoryRow] = useState<Row | null>(null)
  const qc = useQueryClient()

  const { data: facets } = useQuery({
    queryKey: ['inv-facets', status, search],
    queryFn: () => getFacets(status, search),
    staleTime: 60_000,
  })

  const { data: dropdownOptions } = useQuery({
    queryKey: ['inventory-dropdown-options'],
    queryFn: async () => (await client.get('/api/v1/inventory/dropdown-options')).data,
    staleTime: 5 * 60_000,
  })

  const queryKey = ['inventory', status, search, filters, sort, page]
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getInventory(status, search, filters, sort, page, facets),
  })

  const items: Row[] = data?.items ?? []

  // Salva subito in cache (ottimistico) e manda il PATCH in background;
  // se fallisce, ripristina rifacendo il fetch.
  const handleEdit: EditFn = (listingId, patch) => {
    qc.setQueryData(queryKey, (old: typeof data) => old ? {
      ...old,
      items: old.items.map((it: Row) => it.listing_id === listingId
        ? { ...it, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])) }
        : it),
    } : old)
    patchItem(listingId, patch).catch(() => {
      message.error('Errore durante il salvataggio, ripristino i dati.')
      qc.invalidateQueries({ queryKey: ['inventory'] })
    })
  }

  // Colonna azione "Vendite & Mercato" (solo se l'articolo ha release_id)
  const columns: ColumnType<Row>[] = [
    ...makeColumns(handleEdit, dropdownOptions),
    {
      title: '', key: 'sales', width: 48, align: 'center' as const,
      render: (_: unknown, r: Row) => r.release_id ? (
        <Tooltip title="Vendite & Mercato">
          <Button size="small" type="text" icon={<LineChartOutlined />}
            onClick={(e) => { e.stopPropagation(); setSalesRow(r) }} />
        </Tooltip>
      ) : null,
    },
    {
      title: '', key: 'history', width: 44, align: 'center' as const,
      render: (_: unknown, r: Row) => (
        <Tooltip title="Storico modifiche">
          <Button size="small" type="text" icon={<HistoryOutlined />}
            onClick={(e) => { e.stopPropagation(); setHistoryRow(r) }} />
        </Tooltip>
      ),
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
        <Select placeholder="Fonte" style={selStyle} allowClear showSearch
          value={filters.source} onChange={(v) => setF('source', v)}
          options={opts(facets?.sources ?? [])} />
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
        myListed={salesRow?.listed}
        myAddDate={salesRow?.add_date}
        title={salesRow ? `${salesRow.artist} — ${salesRow.title}` : undefined}
        onClose={() => setSalesRow(null)}
      />

      <HistoryDrawer
        listingId={historyRow?.listing_id ?? null}
        title={historyRow ? `${historyRow.artist} — ${historyRow.title}` : undefined}
        onClose={() => setHistoryRow(null)}
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
  const [pushProg, setPushProg] = useState<{ pending: number; running: boolean; processed: number; total: number; errors: number } | null>(null)
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

  const prevEnrichRunning = useRef<boolean | null>(null)
  useEffect(() => {
    fetchEnrichStatus()
    const id = setInterval(async () => {
      const s = await fetchEnrichStatus()
      // invalida solo quando transiziona da running → stopped
      if (s && prevEnrichRunning.current === true && !s.running) {
        qc.invalidateQueries({ queryKey: ['inventory'] })
        qc.invalidateQueries({ queryKey: ['inv-facets'] })
      }
      prevEnrichRunning.current = s?.running ?? false
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

  // Polling stato coda push verso Discogs (parte da sola dopo le modifiche in tabella)
  const fetchPushStatus = async () => {
    try {
      const r = await client.get('/api/v1/inventory/discogs-push-status')
      setPushProg(r.data)
      return r.data
    } catch { return null }
  }

  useEffect(() => {
    fetchPushStatus()
    const id = setInterval(fetchPushStatus, 4000)
    return () => clearInterval(id)
  }, [])

  const handlePushStop = async () => {
    await client.post('/api/v1/inventory/discogs-push-stop')
    message.info('Sincronizzazione Discogs in arresto…')
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
        {pushProg && (pushProg.pending > 0 || pushProg.running) && (
          <Tooltip title="Le modifiche fatte in tabella (prezzo, condizioni, location...) vengono rimandate all'inserzione reale su Discogs">
            <Tag color={pushProg.running ? 'processing' : 'default'}>
              {pushProg.running ? '🔄' : '⏳'} Sync Discogs {pushProg.processed}/{pushProg.total || pushProg.pending}
            </Tag>
          </Tooltip>
        )}
        {pushProg?.running && <Button danger size="small" onClick={handlePushStop}>Stop sync</Button>}
        {!!pushProg?.errors && (
          <Tooltip title="Alcune modifiche non sono state inviate a Discogs (vedi colonna dettagli articolo)">
            <Tag color="error">⚠️ {pushProg.errors} errori sync</Tag>
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
