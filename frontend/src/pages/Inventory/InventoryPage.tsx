import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Table, Input, Tabs, Tag, Button, message, Alert } from 'antd'
import type { ColumnType } from 'antd/es/table'
import { PlusOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons'
import client from '@/api/client'
import AddInventoryModal from './AddInventoryModal'

// Mappa colonne CSV → label italiano
const LABELS: Record<string, string> = {
  source: 'Fonte', listing_id: 'ID', artist: 'Artista', title: 'Titolo',
  label: 'Label', catno: 'Cat#', format: 'Formato', price: 'Prezzo',
  listed: 'Data', media_condition: 'Media', sleeve_condition: 'Sleeve',
  location: 'Location', external_id: 'Ext.ID', comments: 'Note',
  quantity: 'Qtà', status: 'Status', release_id: 'Release ID',
  weight: 'Peso', ships_from: 'Spedisce da', currency: 'Valuta',
  allow_offers: 'Offerte', seller: 'Venditore', country: 'Paese',
  year: 'Anno', genres: 'Generi', styles: 'Stili',
}

// Colonne da nascondere (ridondanti o tecniche)
const HIDDEN = new Set(['status', '_id'])

// Colonne con larghezza fissa
const WIDTHS: Record<string, number> = {
  source: 80, listing_id: 100, catno: 90, format: 110, price: 85,
  listed: 130, quantity: 50, weight: 60, release_id: 100,
  allow_offers: 70, currency: 65, year: 60,
}

function formatPrice(v: string): string {
  const n = parseFloat(v)
  if (isNaN(n)) return v || '—'
  return `€ ${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

function buildColumns(sample: Record<string, string>): ColumnType<Record<string, string>>[] {
  // Ordine preferito delle colonne principali
  const preferred = ['source', 'listing_id', 'artist', 'title', 'label', 'catno',
    'format', 'price', 'listed', 'media_condition', 'sleeve_condition', 'location',
    'comments', 'weight', 'external_id']

  const allKeys = Object.keys(sample)
  const ordered = [
    ...preferred.filter(k => allKeys.includes(k)),
    ...allKeys.filter(k => !preferred.includes(k) && !HIDDEN.has(k)),
  ]

  return ordered.map(key => {
    const col: ColumnType<Record<string, string>> = {
      title: LABELS[key] ?? key,
      dataIndex: key,
      key,
      ellipsis: true,
    }
    if (WIDTHS[key]) col.width = WIDTHS[key]
    if (key === 'source') col.render = (v: string) => <Tag>{v}</Tag>
    if (key === 'price') col.render = (v: string) => formatPrice(v)
    return col
  })
}

async function getInventory(status?: string, q?: string, page = 1) {
  const res = await client.get('/api/v1/inventory', {
    params: { status, q: q || undefined, page, page_size: 100 },
  })
  return res.data
}

async function syncDiscogs() {
  const res = await client.post('/api/v1/inventory/sync')
  return res.data
}

function InventoryTable({ status }: { status: string }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', status, search, page],
    queryFn: () => getInventory(status, search, page),
  })

  const items: Record<string, string>[] = data?.items ?? []
  const columns = items.length > 0 ? buildColumns(items[0]) : []

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input
          placeholder="Cerca artista, titolo, cat#..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          style={{ width: 320 }}
          allowClear
        />
        <span style={{ lineHeight: '32px', color: '#888' }}>{data?.total ?? 0} articoli</span>
      </div>
      <Table
        dataSource={items}
        columns={columns}
        rowKey={(r) => `${r.source}-${r.listing_id}`}
        loading={isLoading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ current: page, total: data?.total ?? 0, pageSize: 100, onChange: setPage }}
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
  const qc = useQueryClient()

  const handleSync = async () => {
    setSyncing(true)
    setSyncInfo(null)
    try {
      const res = await syncDiscogs()
      setSyncInfo(`✅ ${res.rows} articoli scaricati (${res.filename})`)
      qc.invalidateQueries({ queryKey: ['inventory'] })
    } catch {
      message.error('Errore durante il sync con Discogs. Controlla i log del server.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>📦 Inventario</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          Add Inventory
        </Button>
        <Button icon={<SyncOutlined spin={syncing} />} onClick={handleSync} loading={syncing}>
          {syncing ? 'Download da Discogs...' : 'Aggiorna da Discogs'}
        </Button>
        {syncing && <span style={{ color: '#888', fontSize: 13 }}>Può richiedere 2-5 minuti...</span>}
      </div>

      {syncInfo && (
        <Alert message={syncInfo} type="success" showIcon closable
          style={{ marginBottom: 12 }} onClose={() => setSyncInfo(null)} />
      )}

      <Tabs items={tabItems} size="large" />

      <AddInventoryModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => {
          setAddOpen(false)
          qc.invalidateQueries({ queryKey: ['inventory'] })
        }}
      />
    </div>
  )
}
