import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Table, Input, Tabs, Tag, Button, message, Alert } from 'antd'
import { PlusOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons'
import client from '@/api/client'
import AddInventoryModal from './AddInventoryModal'

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

  const columns = [
    { title: 'Fonte', dataIndex: 'source', width: 90, render: (v: string) => <Tag>{v}</Tag> },
    { title: 'ID', dataIndex: 'listing_id', width: 95 },
    { title: 'Artista', dataIndex: 'artist', width: 150, ellipsis: true },
    { title: 'Titolo', dataIndex: 'title', ellipsis: true },
    { title: 'Label', dataIndex: 'label', width: 120, ellipsis: true },
    { title: 'Cat#', dataIndex: 'catno', width: 80 },
    { title: 'Formato', dataIndex: 'format', width: 110 },
    { title: 'Prezzo', dataIndex: 'price', width: 80 },
    { title: 'Data', dataIndex: 'listed', width: 130 },
    { title: 'Media', dataIndex: 'media_condition', width: 130, ellipsis: true },
  ]

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
        dataSource={data?.items ?? []}
        columns={columns}
        rowKey={(r: any) => `${r.source}-${r.listing_id}`}
        loading={isLoading}
        size="small"
        scroll={{ x: 1100 }}
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
      // Invalida tutte le query inventory per ricaricare i dati
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
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setAddOpen(true)}
        >
          Add Inventory
        </Button>
        <Button
          icon={<SyncOutlined spin={syncing} />}
          onClick={handleSync}
          loading={syncing}
        >
          {syncing ? 'Download da Discogs...' : 'Aggiorna da Discogs'}
        </Button>
        {syncing && (
          <span style={{ color: '#888', fontSize: 13 }}>
            Può richiedere 2-5 minuti...
          </span>
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
        onSuccess={() => {
          setAddOpen(false)
          qc.invalidateQueries({ queryKey: ['inventory'] })
        }}
      />
    </div>
  )
}
