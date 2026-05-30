import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table, Select, Tag, Button, Space, Typography } from 'antd'
import type { ColumnType } from 'antd/es/table'
import { ReloadOutlined } from '@ant-design/icons'
import client from '@/api/client'

const { Link } = Typography

const STATUS_COLORS: Record<string, string> = {
  'New Order': 'blue',
  'Invoice Sent': 'cyan',
  'Payment Pending': 'orange',
  'Payment Received': 'green',
  'In Progress': 'geekblue',
  'Shipped': 'success',
  'Cancelled': 'error',
  'Cancelled (Non-Paying Buyer)': 'error',
  'Cancelled (Item Unavailable)': 'error',
  "Cancelled (Per Buyer's Request)": 'error',
  'Merged': 'default',
  'Order Changed': 'warning',
}

const ALL_STATUSES = [
  'All', 'New Order', 'Invoice Sent', 'Payment Pending', 'Payment Received',
  'In Progress', 'Shipped', 'Merged', 'Order Changed',
  'Cancelled (Non-Paying Buyer)', 'Cancelled (Item Unavailable)',
  "Cancelled (Per Buyer's Request)", 'Cancelled',
]

interface Order {
  id: string
  uri: string
  status: string
  created: string
  buyer: string
  buyer_url: string
  release: string
  listing_id: number
  media_condition: string
  sleeve_condition: string
  items_count: number
  price: number
  currency: string
  shipping: number
  fee: number
}

async function getOrders(status: string, sortOrder: string, page: number) {
  const res = await client.get('/api/v1/integrations/discogs/orders', {
    params: { status, sort_order: sortOrder, page, per_page: 50 },
  })
  return res.data
}

const columns: ColumnType<Order>[] = [
  {
    title: 'Data',
    dataIndex: 'created',
    width: 100,
  },
  {
    title: 'Ordine',
    dataIndex: 'id',
    width: 120,
    render: (id: string, r: Order) => (
      <Link href={r.uri} target="_blank">{id}</Link>
    ),
  },
  {
    title: 'Articolo',
    dataIndex: 'release',
    ellipsis: true,
    render: (release: string, r: Order) =>
      r.listing_id
        ? <Link href={`https://www.discogs.com/sell/item/${r.listing_id}`} target="_blank">{release}</Link>
        : release,
  },
  {
    title: 'Media',
    dataIndex: 'media_condition',
    width: 130,
    ellipsis: true,
  },
  {
    title: 'Sleeve',
    dataIndex: 'sleeve_condition',
    width: 130,
    ellipsis: true,
  },
  {
    title: 'Acquirente',
    dataIndex: 'buyer',
    width: 140,
    render: (buyer: string, r: Order) => (
      <Link href={r.buyer_url} target="_blank">{buyer}</Link>
    ),
  },
  {
    title: 'Totale',
    dataIndex: 'price',
    width: 90,
    align: 'right' as const,
    render: (v: number, r: Order) => `${r.currency} ${v.toFixed(2)}`,
  },
  {
    title: 'Spediz.',
    dataIndex: 'shipping',
    width: 80,
    align: 'right' as const,
    render: (v: number, r: Order) => v ? `${r.currency} ${v.toFixed(2)}` : '—',
  },
  {
    title: 'Stato',
    dataIndex: 'status',
    width: 160,
    render: (s: string) => <Tag color={STATUS_COLORS[s] ?? 'default'}>{s}</Tag>,
  },
]

export default function DiscogsOrdersPage() {
  const [status, setStatus] = useState('All')
  const [sortOrder, setSortOrder] = useState('desc')
  const [page, setPage] = useState(1)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['discogs-orders', status, sortOrder, page],
    queryFn: () => getOrders(status, sortOrder, page),
  })

  const orders: Order[] = data?.orders ?? []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🎵 Ordini Discogs</h2>
        <Space>
          <Select
            value={status}
            onChange={(v) => { setStatus(v); setPage(1) }}
            style={{ width: 220 }}
            options={ALL_STATUSES.map(s => ({ value: s, label: s }))}
          />
          <Select
            value={sortOrder}
            onChange={(v) => { setSortOrder(v); setPage(1) }}
            style={{ width: 130 }}
            options={[
              { value: 'desc', label: '↓ Più recenti' },
              { value: 'asc', label: '↑ Più vecchi' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
            Aggiorna
          </Button>
        </Space>
        <span style={{ color: '#888', fontSize: 13 }}>
          {data?.total ?? 0} ordini totali
        </span>
      </div>

      <Table
        dataSource={orders}
        columns={columns}
        rowKey="id"
        loading={isLoading || isFetching}
        size="small"
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          total: data?.total ?? 0,
          pageSize: 50,
          onChange: setPage,
          showSizeChanger: false,
        }}
      />
    </div>
  )
}
