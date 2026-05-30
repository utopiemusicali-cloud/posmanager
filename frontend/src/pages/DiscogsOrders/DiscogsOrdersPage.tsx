import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table, Select, Tag, Button, Modal, Form, Input,
  Row, Col, Card, Statistic, Descriptions, Space,
  message, Typography, Spin, Divider,
} from 'antd'
import type { ColumnType } from 'antd/es/table'
import { ReloadOutlined, SendOutlined, CloseCircleOutlined } from '@ant-design/icons'
import client from '@/api/client'
import dayjs from 'dayjs'

const { Link, Text } = Typography

// ── Tipi ──────────────────────────────────────────────────────────────────────

interface Order {
  id: string
  uri: string
  status: string
  created: string
  last_activity: string
  'buyer.username': string
  'buyer.resource_url'?: string
  'total.value': number
  'total.currency': string
  'shipping.value': number
  'shipping.method': string
  'fee.value': number
  'tax.value'?: number
  shipping_address: string
  messages_url: string
  items: Array<{
    release?: { id: number; description: string }
    price?: { value: number; currency: string }
    media_condition?: string
    sleeve_condition?: string
    id?: number
  }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  'Shipped': 'success',
  'Payment Received': 'warning',
  'In Progress': 'processing',
  'New Order': 'blue',
  'Invoice Sent': 'cyan',
  'Payment Pending': 'orange',
  'Cancelled': 'error',
  'Cancelled (Non-Paying Buyer)': 'error',
  'Cancelled (Item Unavailable)': 'error',
  "Cancelled (Per Buyer's Request)": 'error',
  'Merged': 'default',
  'Order Changed': 'gold',
}

const ROW_BG: Record<string, string> = {
  'Shipped': '#d5f5e3',
  'Payment Received': '#fdebd0',
  'In Progress': '#d6eaf8',
}

function fmtDate(s: string): string {
  if (!s) return '—'
  return dayjs(s).format('DD/MM/YYYY HH:mm')
}

function fmtEur(v: number | undefined, currency = 'EUR'): string {
  if (!v) return '—'
  return `${currency} ${v.toFixed(2)}`
}

function hasPhone(addr: string): boolean {
  return /Phone:\s*\S+/.test(addr)
}

function shipType(method: string): string {
  if (!method) return '—'
  const m = method.toLowerCase()
  if (m.includes('economy')) return 'Economy'
  if (m.includes('express') || m.includes('priority')) return 'Express'
  return method.slice(0, 10)
}

function countryFlag(addr: string): string {
  if (!addr) return '—'
  const lines = addr.split('\n').map(l => l.trim()).filter(Boolean)
  // L'ultima riga non vuota di solito è la nazione
  const last = lines[lines.length - 1] ?? ''
  return last
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function loadYear(year: number) {
  const res = await client.get(`/api/v1/integrations/discogs/orders/year/${year}`)
  return res.data as { orders: Order[]; total: number }
}

async function shipOrder(orderId: string, tracking: string, buyer: string, method: string) {
  await client.post(`/api/v1/integrations/discogs/orders/${orderId}/ship`, {
    tracking, buyer, shipping_method: method,
  })
}

async function cancelOrder(orderId: string, reason: string) {
  await client.post(`/api/v1/integrations/discogs/orders/${orderId}/cancel`, { reason })
}

// ── Colonne tabella ───────────────────────────────────────────────────────────

function buildColumns(onRowClick: (o: Order) => void): ColumnType<Order>[] {
  return [
    { title: 'Creazione', key: 'created', width: 135,
      render: (_: unknown, r: Order) => fmtDate(r.created) },
    { title: 'Ult. Attività', key: 'activity', width: 135,
      render: (_: unknown, r: Order) => fmtDate(r.last_activity) },
    { title: 'ID Ordine', key: 'id', width: 115,
      render: (_: unknown, r: Order) => (
        <Link href={r.uri} target="_blank" onClick={e => e.stopPropagation()}>{r.id}</Link>
      )},
    { title: 'Nazione', key: 'country', width: 110, ellipsis: true,
      render: (_: unknown, r: Order) => countryFlag(r.shipping_address) },
    { title: 'Sped.', key: 'sped', width: 80,
      render: (_: unknown, r: Order) => shipType(r['shipping.method']) },
    { title: 'Status', key: 'status', width: 160,
      render: (_: unknown, r: Order) => <Tag color={STATUS_COLOR[r.status] ?? 'default'}>{r.status}</Tag> },
    { title: 'Items', key: 'items', width: 55, align: 'center' as const,
      render: (_: unknown, r: Order) => r.items?.length ?? 0 },
    { title: 'Totale', key: 'total', width: 100, align: 'right' as const,
      render: (_: unknown, r: Order) => fmtEur(r['total.value'], r['total.currency']) },
    { title: 'Buyer', key: 'buyer', width: 130, ellipsis: true,
      render: (_: unknown, r: Order) => r['buyer.username'] },
    { title: '📞', key: 'phone', width: 45, align: 'center' as const,
      render: (_: unknown, r: Order) => hasPhone(r.shipping_address)
        ? <Text type="success">✓</Text>
        : <Text type="danger">✗</Text> },
  ]
}

// ── Modal dettaglio ordine ─────────────────────────────────────────────────────

function OrderModal({ order, onClose, onRefresh }: {
  order: Order | null
  onClose: () => void
  onRefresh: () => void
}) {
  const [shipForm] = Form.useForm()
  const [cancelForm] = Form.useForm()
  const [tab, setTab] = useState<'info' | 'ship' | 'cancel'>('info')

  const shipMutation = useMutation({
    mutationFn: (v: { tracking: string }) =>
      shipOrder(order!.id, v.tracking, order!['buyer.username'], order!['shipping.method']),
    onSuccess: () => {
      message.success('Ordine marcato come Spedito e messaggio inviato al buyer')
      shipForm.resetFields()
      onRefresh()
      onClose()
    },
    onError: () => message.error('Errore durante la spedizione'),
  })

  const cancelMutation = useMutation({
    mutationFn: (v: { reason: string }) => cancelOrder(order!.id, v.reason),
    onSuccess: () => {
      message.success('Ordine cancellato')
      cancelForm.resetFields()
      onRefresh()
      onClose()
    },
    onError: () => message.error('Errore durante la cancellazione'),
  })

  if (!order) return null

  const addr = order.shipping_address || ''
  const addrLines = addr.split('\n').map(l => l.trim()).filter(Boolean)

  return (
    <Modal
      open={!!order}
      onCancel={onClose}
      title={`Ordine ${order.id}`}
      width={700}
      footer={null}
    >
      {/* Tab selezione */}
      <Space style={{ marginBottom: 16 }}>
        <Button type={tab === 'info' ? 'primary' : 'default'} onClick={() => setTab('info')}>Info</Button>
        <Button type={tab === 'ship' ? 'primary' : 'default'} onClick={() => setTab('ship')}
          disabled={order.status === 'Shipped' || order.status.includes('Cancelled')}>
          Segna Spedito
        </Button>
        <Button type={tab === 'cancel' ? 'primary' : 'default'} danger onClick={() => setTab('cancel')}
          disabled={order.status.includes('Cancelled')}>
          Cancella Ordine
        </Button>
      </Space>

      {tab === 'info' && (
        <>
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label="ID Ordine">
              <Link href={order.uri} target="_blank">{order.id}</Link>
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={STATUS_COLOR[order.status] ?? 'default'}>{order.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Creazione">{fmtDate(order.created)}</Descriptions.Item>
            <Descriptions.Item label="Ult. Attività">{fmtDate(order.last_activity)}</Descriptions.Item>
            <Descriptions.Item label="Buyer">
              <Link href={`https://www.discogs.com/user/${order['buyer.username']}`} target="_blank">
                {order['buyer.username']}
              </Link>
            </Descriptions.Item>
            <Descriptions.Item label="📞">{hasPhone(addr) ? '✓ Presente' : '✗ Mancante'}</Descriptions.Item>
            <Descriptions.Item label="Totale">{fmtEur(order['total.value'], order['total.currency'])}</Descriptions.Item>
            <Descriptions.Item label="Spedizione">{fmtEur(order['shipping.value'], order['total.currency'])}</Descriptions.Item>
            <Descriptions.Item label="Fee">{fmtEur(order['fee.value'], order['total.currency'])}</Descriptions.Item>
            <Descriptions.Item label="Metodo sped.">{order['shipping.method'] || '—'}</Descriptions.Item>
          </Descriptions>

          <Divider orientation="left" plain>Articoli</Divider>
          {(order.items || []).map((item, i) => (
            <Card key={i} size="small" style={{ marginBottom: 8 }}>
              <Text strong>{item.release?.description ?? '—'}</Text>
              <br />
              <Text type="secondary">
                Media: {item.media_condition ?? '—'} · Sleeve: {item.sleeve_condition ?? '—'} ·
                Prezzo: {fmtEur(item.price?.value, item.price?.currency)}
              </Text>
            </Card>
          ))}

          <Divider orientation="left" plain>Indirizzo Spedizione</Divider>
          <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
            {addrLines.join('\n') || '—'}
          </pre>
        </>
      )}

      {tab === 'ship' && (
        <Form form={shipForm} layout="vertical"
          onFinish={(v) => shipMutation.mutate(v)}>
          <Form.Item label="Numero di tracking" name="tracking"
            rules={[{ required: true, message: 'Obbligatorio' }]}>
            <Input placeholder="es. 3S12345678901234 / 1Z999AA10123456784" />
          </Form.Item>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Verrà inviato automaticamente un messaggio al buyer con il link di tracking.<br />
            Il sistema rileva il corriere dal formato del numero (3S=PostNL, 1Z=UPS, ecc.)
          </Text>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />}
            loading={shipMutation.isPending}>
            Segna come Spedito e invia messaggio
          </Button>
        </Form>
      )}

      {tab === 'cancel' && (
        <Form form={cancelForm} layout="vertical"
          onFinish={(v) => cancelMutation.mutate(v)}>
          <Form.Item label="Motivo cancellazione" name="reason"
            rules={[{ required: true, message: 'Obbligatorio' }]}>
            <Input.TextArea rows={3}
              placeholder="es. Item not available / Per richiesta del buyer" />
          </Form.Item>
          <Button danger htmlType="submit" icon={<CloseCircleOutlined />}
            loading={cancelMutation.isPending}>
            Cancella ordine
          </Button>
        </Form>
      )}
    </Modal>
  )
}

// ── Pagina principale ──────────────────────────────────────────────────────────

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const m = String(i + 1).padStart(2, '0')
  return { value: `${new Date().getFullYear()}-${m}`, label: dayjs(`${new Date().getFullYear()}-${m}-01`).format('MMMM YYYY') }
})

export default function DiscogsOrdersPage() {
  const year = new Date().getFullYear()
  const currentMonth = dayjs().format('YYYY-MM')
  const [month, setMonth] = useState(currentMonth)
  const [selected, setSelected] = useState<Order | null>(null)
  const qc = useQueryClient()

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['discogs-orders-year', year],
    queryFn: () => loadYear(year),
    staleTime: 5 * 60 * 1000,
  })

  // Filtra per mese selezionato
  const monthOrders = useMemo<Order[]>(() => {
    if (!data?.orders) return []
    return data.orders.filter(o => (o.created || '').startsWith(month))
  }, [data, month])

  // Statistiche mese
  const stats = useMemo(() => {
    const active = monthOrders.filter(o => !o.status.includes('Cancelled'))
    return {
      totale: active.reduce((s, o) => s + (o['total.value'] ?? 0), 0),
      n: active.length,
      cancellati: monthOrders.filter(o => o.status.includes('Cancelled')).length,
      spediti: monthOrders.filter(o => o.status === 'Shipped').length,
      da_spedire: monthOrders.filter(o => ['Payment Received', 'In Progress'].includes(o.status)).length,
      fees: monthOrders.reduce((s, o) => s + (o['fee.value'] ?? 0), 0),
      tax: monthOrders.reduce((s, o) => s + ((o as any)['tax.value'] ?? 0), 0),
      spedizioni: monthOrders.reduce((s, o) => s + (o['shipping.value'] ?? 0), 0),
    }
  }, [monthOrders])

  const columns = buildColumns(setSelected)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🎵 Ordini Discogs {year}</h2>
        <Select
          value={month}
          onChange={setMonth}
          style={{ width: 160 }}
          options={MONTHS}
        />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
          Aggiorna
        </Button>
        {isLoading && <Spin />}
      </div>

      {/* Statistiche */}
      <Row gutter={8} style={{ marginBottom: 16 }}>
        {[
          { label: 'TOTALE ORDINI', value: `€ ${stats.totale.toFixed(2)}`, color: '#27ae60' },
          { label: 'N° ORDINI', value: stats.n, color: '#3498db' },
          { label: 'CANCELLATI', value: stats.cancellati, color: '#e74c3c' },
          { label: 'SPEDITI', value: stats.spediti, color: '#9b59b6' },
          { label: 'DA SPEDIRE', value: stats.da_spedire, color: '#e67e22' },
          { label: 'FEES', value: `€ ${stats.fees.toFixed(2)}`, color: '#e74c3c' },
          { label: 'TOT TAX', value: `€ ${stats.tax.toFixed(2)}`, color: '#95a5a6' },
          { label: 'TOT SPED.', value: `€ ${stats.spedizioni.toFixed(2)}`, color: '#16a085' },
        ].map(s => (
          <Col key={s.label} flex={1}>
            <Card size="small" bodyStyle={{ padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#666', fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Tabella */}
      <Table
        dataSource={monthOrders}
        columns={columns}
        rowKey="id"
        loading={isLoading || isFetching}
        size="small"
        scroll={{ x: 1100 }}
        onRow={(r) => ({
          onClick: () => setSelected(r),
          style: { cursor: 'pointer', background: ROW_BG[r.status] ?? undefined },
        })}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        footer={() => (
          <span style={{ color: '#888', fontSize: 12 }}>
            {monthOrders.length} ordini nel mese · {data?.total ?? 0} totali {year} · Click per dettagli
          </span>
        )}
      />

      {/* Modal dettaglio */}
      <OrderModal
        order={selected}
        onClose={() => setSelected(null)}
        onRefresh={() => qc.invalidateQueries({ queryKey: ['discogs-orders-year', year] })}
      />
    </div>
  )
}
