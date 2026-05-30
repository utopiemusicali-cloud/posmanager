import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table, Input, Tabs, Tag, Button, message } from 'antd'
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import client from '@/api/client'

async function getInventory(status?: string, q?: string, page = 1) {
  const res = await client.get('/api/v1/inventory', {
    params: { status, q: q || undefined, page, page_size: 100 },
  })
  return res.data
}

function InventoryTable({ status }: { status: string }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, refetch } = useQuery({
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
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Ricarica</Button>
        <span style={{ lineHeight: '32px', color: '#888' }}>{data?.total ?? 0} articoli</span>
      </div>
      <Table
        dataSource={data?.items ?? []}
        columns={columns}
        rowKey={(r) => `${r.source}-${r.listing_id}`}
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
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>📦 Inventario</h2>
      <Tabs items={tabItems} size="large" />
    </div>
  )
}
