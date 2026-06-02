import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Table, Input, Tabs, Tag, Button, message, Alert } from 'antd'
import type { ColumnType } from 'antd/es/table'
import { PlusOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons'
import client from '@/api/client'
import AddInventoryModal from './AddInventoryModal'

type Row = Record<string, string>

function formatPrice(v: string): string {
  const n = parseFloat(v)
  if (isNaN(n)) return v || '—'
  return `€ ${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

function formatDate(v: string): string {
  if (!v) return '—'
  // ISO "2026-05-20 10:30:00" → "20/05/2026"
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return v.split(' ')[0]
}

// Colonne raggruppate → tabella più corta e leggibile
const groupedColumns: ColumnType<Row>[] = [
  {
    title: 'Fonte',
    dataIndex: 'source',
    width: 80,
    render: (v: string) => <Tag>{v}</Tag>,
  },
  {
    title: 'Articolo',
    key: 'articolo',
    render: (_: unknown, r: Row) => (
      <div style={{ lineHeight: 1.35 }}>
        <div style={{ fontWeight: 600 }}>
          {r.artist || '—'}{r.title ? ` — ${r.title}` : ''}
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>
          {[r.label, r.catno, r.format].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
    ),
  },
  {
    title: 'Prezzo / Condizioni',
    key: 'prezzo',
    width: 200,
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
    title: 'Location / Note',
    key: 'location',
    width: 200,
    render: (_: unknown, r: Row) => (
      <div style={{ lineHeight: 1.35 }}>
        {r.location && <div style={{ fontWeight: 600, color: '#1677ff' }}>📍 {r.location}</div>}
        {r.comments && <div style={{ fontSize: 12, color: '#888' }}>{r.comments}</div>}
        {!r.location && !r.comments && <span style={{ color: '#ccc' }}>—</span>}
      </div>
    ),
  },
  {
    title: 'ID',
    dataIndex: 'listing_id',
    width: 100,
    render: (v: string) => <span style={{ fontSize: 11, color: '#999' }}>{v}</span>,
  },
]

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

  const items: Row[] = data?.items ?? []

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
        columns={groupedColumns}
        rowKey={(r) => `${r.source}-${r.listing_id}`}
        loading={isLoading}
        size="small"
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
