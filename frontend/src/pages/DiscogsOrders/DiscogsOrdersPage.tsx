import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table, Select, Tag, Button, Modal, Form, Input, InputNumber,
  Row, Col, Card, Descriptions, Space, Checkbox,
  message, Typography, Spin, Divider,
} from 'antd'
import type { ColumnType } from 'antd/es/table'
import {
  ReloadOutlined, SendOutlined, CloseCircleOutlined,
  PrinterOutlined, MailOutlined, WhatsAppOutlined,
} from '@ant-design/icons'
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
  'buyer.email'?: string
  'total.value': number
  'total.currency': string
  'shipping.value': number
  'shipping.method': string
  'fee.value': number
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
  'Shipped': 'success', 'Payment Received': 'warning',
  'In Progress': 'processing', 'New Order': 'blue',
  'Invoice Sent': 'cyan', 'Payment Pending': 'orange',
  'Cancelled': 'error', 'Cancelled (Non-Paying Buyer)': 'error',
  'Cancelled (Item Unavailable)': 'error',
  "Cancelled (Per Buyer's Request)": 'error',
  'Merged': 'default', 'Order Changed': 'gold',
}

const ROW_BG: Record<string, string> = {
  'Shipped': '#d5f5e3', 'Payment Received': '#fdebd0', 'In Progress': '#d6eaf8',
}

function fmtDate(s: string): string {
  return s ? dayjs(s).format('DD/MM/YYYY HH:mm') : '—'
}

function fmtEur(v: number | undefined, currency = 'EUR'): string {
  if (!v) return '—'
  return `${currency} ${v.toFixed(2)}`
}

function parseAddr(addr: string) {
  const lines = addr.split('\n').map(l => l.trim()).filter(Boolean)
  let phone = '', paypal = '', country = ''
  for (const l of lines) {
    if (l.startsWith('Phone:')) phone = l.replace('Phone:', '').trim()
    if (l.toLowerCase().startsWith('paypal address:') || l.toLowerCase().startsWith('paypal:'))
      paypal = l.replace(/paypal address:|paypal:/i, '').trim()
  }
  // Ultima riga non speciale = paese
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (!l.startsWith('Phone:') && !l.toLowerCase().startsWith('paypal')) {
      country = l; break
    }
  }
  // Numero pulito per WhatsApp (solo cifre, rimuovi 00 iniziale)
  let phoneClean = phone.replace(/[^\d]/g, '')
  if (phoneClean.startsWith('00')) phoneClean = phoneClean.slice(2)
  return { phone, phoneClean, paypal, country, lines }
}

function shipType(method: string): string {
  if (!method) return '—'
  const m = method.toLowerCase()
  if (m.includes('economy')) return 'Economy'
  if (m.includes('express') || m.includes('priority')) return 'Express'
  return method.slice(0, 10)
}

// ── API ────────────────────────────────────────────────────────────────────────

async function loadYear(year: number) {
  const res = await client.get(`/api/v1/integrations/discogs/orders/year/${year}`)
  return res.data as { orders: Order[]; total: number }
}

async function doShip(orderId: string, tracking: string, buyer: string, method: string) {
  await client.post(`/api/v1/integrations/discogs/orders/${orderId}/ship`,
    { tracking, buyer, shipping_method: method })
}

async function doCancel(orderId: string, reason: string) {
  await client.post(`/api/v1/integrations/discogs/orders/${orderId}/cancel`, { reason })
}

// ── Colonne ────────────────────────────────────────────────────────────────────

function buildColumns(): ColumnType<Order>[] {
  return [
    { title: 'Creazione', key: 'c', width: 135, render: (_: unknown, r: Order) => fmtDate(r.created) },
    { title: 'Ult. Attività', key: 'a', width: 135, render: (_: unknown, r: Order) => fmtDate(r.last_activity) },
    { title: 'ID Ordine', key: 'id', width: 115,
      render: (_: unknown, r: Order) =>
        <Link href={r.uri} target="_blank" onClick={e => e.stopPropagation()}>{r.id}</Link> },
    { title: 'Nazione', key: 'nat', width: 110, ellipsis: true,
      render: (_: unknown, r: Order) => parseAddr(r.shipping_address).country },
    { title: 'Sped.', key: 'sped', width: 80, render: (_: unknown, r: Order) => shipType(r['shipping.method']) },
    { title: 'Status', key: 'st', width: 165,
      render: (_: unknown, r: Order) => <Tag color={STATUS_COLOR[r.status] ?? 'default'}>{r.status}</Tag> },
    { title: 'Items', key: 'it', width: 55, align: 'center' as const,
      render: (_: unknown, r: Order) => r.items?.length ?? 0 },
    { title: 'Totale', key: 'tot', width: 100, align: 'right' as const,
      render: (_: unknown, r: Order) => fmtEur(r['total.value'], r['total.currency']) },
    { title: 'Buyer', key: 'b', width: 130, ellipsis: true,
      render: (_: unknown, r: Order) => r['buyer.username'] },
    { title: '📞', key: 'ph', width: 45, align: 'center' as const,
      render: (_: unknown, r: Order) => parseAddr(r.shipping_address).phone
        ? <Text type="success">✓</Text> : <Text type="danger">✗</Text> },
  ]
}

// ── Modal dettaglio ────────────────────────────────────────────────────────────

function OrderModal({ order, onClose, onRefresh }: {
  order: Order | null; onClose: () => void; onRefresh: () => void
}) {
  const [shipForm] = Form.useForm()
  const [cancelForm] = Form.useForm()
  const [tab, setTab] = useState<'info' | 'ship' | 'cancel'>('info')
  const [carriers, setCarriers] = useState<string[]>([])

  const shipMut = useMutation({
    mutationFn: (v: { tracking: string }) => {
      const method = carriers.length ? carriers.join(' + ') : (order!['shipping.method'] || '')
      return doShip(order!.id, v.tracking, order!['buyer.username'], method)
    },
    onSuccess: () => {
      message.success('Ordine marcato Shipped, messaggio inviato al buyer')
      shipForm.resetFields(); setCarriers([]); onRefresh(); onClose()
    },
    onError: () => message.error('Errore durante la spedizione'),
  })

  const cancelMut = useMutation({
    mutationFn: (v: { reason: string; notes?: string }) =>
      doCancel(order!.id, v.notes ? `${v.reason}\n\n${v.notes}` : v.reason),
    onSuccess: () => {
      message.success('Ordine cancellato'); cancelForm.resetFields(); onRefresh(); onClose()
    },
    onError: () => message.error('Errore durante la cancellazione'),
  })

  if (!order) return null

  const addr = parseAddr(order.shipping_address)
  const orderSuffix = order.id.includes('-') ? order.id.split('-').pop() : order.id.slice(-3)
  const buyerEmail = (order as any)['buyer.email'] || addr.paypal || ''
  const isEconomy = (order['shipping.method'] || '').toLowerCase().includes('economy')
  const isCancelled = order.status.includes('Cancelled')
  const isShipped = order.status === 'Shipped'

  // Funzioni per i link
  const openEmailBuyer = () => {
    if (!buyerEmail) { message.warning('Email buyer non trovata'); return }
    window.open(`mailto:${buyerEmail}?subject=Order ${order.id}&body=Hello%2C%0A%0ARegarding your Discogs order ${order.id}.%0A%0ABest regards`, '_blank')
  }

  const openEmailAlberto = () => {
    const pesoVal = (shipForm.getFieldValue('peso') || 'N/D') + ' kg'
    const corpo = `${addr.country}, ${pesoVal}, ${order['shipping.method']}\n\n${addr.lines.join('\n')}`
    const encoded = encodeURIComponent(corpo)
    window.open(`mailto:aen@live.it?subject=SPED-${orderSuffix}&body=${encoded}`, '_blank')
  }

  const openWhatsApp = () => {
    if (!addr.phoneClean) { message.warning('Numero di telefono non trovato'); return }
    const msg = encodeURIComponent(`Ciao! Il tuo ordine Discogs ${order.id} è stato spedito.`)
    window.open(`https://wa.me/${addr.phoneClean}?text=${msg}`, '_blank')
  }

  const openPrint = () => {
    window.open(`https://www.discogs.com/sell/order/prints?order_id=${order.id}`, '_blank')
  }

  return (
    <Modal open={!!order} onCancel={onClose}
      title={<Space><span>Ordine {order.id}</span>
        <Tag color={STATUS_COLOR[order.status] ?? 'default'}>{order.status}</Tag></Space>}
      width={780} footer={null}>

      {/* Tabs */}
      <Space style={{ marginBottom: 16 }}>
        <Button type={tab === 'info' ? 'primary' : 'default'} onClick={() => setTab('info')}>Info</Button>
        <Button type={tab === 'ship' ? 'primary' : 'default'} onClick={() => setTab('ship')}
          disabled={isShipped || isCancelled} icon={<SendOutlined />}>Shipped</Button>
        <Button type={tab === 'cancel' ? 'primary' : 'default'} danger onClick={() => setTab('cancel')}
          disabled={isCancelled} icon={<CloseCircleOutlined />}>Cancella</Button>
        <Button icon={<PrinterOutlined />} onClick={openPrint}>Print</Button>
      </Space>

      {/* ── Tab INFO ── */}
      {tab === 'info' && (
        <>
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label="ID Ordine">
              <Link href={order.uri} target="_blank">{order.id}</Link>
            </Descriptions.Item>
            <Descriptions.Item label="Creazione">{fmtDate(order.created)}</Descriptions.Item>
            <Descriptions.Item label="Buyer">
              <Link href={`https://www.discogs.com/user/${order['buyer.username']}`} target="_blank">
                {order['buyer.username']}
              </Link>
            </Descriptions.Item>
            <Descriptions.Item label="Ult. Attività">{fmtDate(order.last_activity)}</Descriptions.Item>
            <Descriptions.Item label="Nazione">{addr.country || '—'}</Descriptions.Item>
            <Descriptions.Item label="Telefono">{addr.phone || '—'}</Descriptions.Item>
            <Descriptions.Item label="Email / PayPal">{buyerEmail || '—'}</Descriptions.Item>
            <Descriptions.Item label="Metodo sped.">{order['shipping.method'] || '—'}</Descriptions.Item>
            <Descriptions.Item label="Totale">{fmtEur(order['total.value'], order['total.currency'])}</Descriptions.Item>
            <Descriptions.Item label="Spedizione">{fmtEur(order['shipping.value'], order['total.currency'])}</Descriptions.Item>
            <Descriptions.Item label="Fee">{fmtEur(order['fee.value'], order['total.currency'])}</Descriptions.Item>
          </Descriptions>

          <Divider orientation="left" plain>Articoli</Divider>
          {(order.items || []).map((item, i) => (
            <Card key={i} size="small" style={{ marginBottom: 6 }}>
              <Text strong>{item.release?.description ?? '—'}</Text><br />
              <Text type="secondary">
                Media: {item.media_condition ?? '—'} · Sleeve: {item.sleeve_condition ?? '—'} ·
                {' '}{fmtEur(item.price?.value, item.price?.currency)}
              </Text>
            </Card>
          ))}

          <Divider orientation="left" plain>Indirizzo Spedizione</Divider>
          <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4, marginBottom: 12 }}>
            {addr.lines.join('\n') || '—'}
          </pre>

          {/* Pulsanti azione */}
          <Space wrap>
            <Button icon={<MailOutlined />} style={{ background: '#e67e22', color: '#fff', borderColor: '#e67e22' }}
              onClick={openEmailBuyer} disabled={!buyerEmail}>
              Email Buyer
            </Button>
            <Button icon={<MailOutlined />} style={{ background: '#3498db', color: '#fff', borderColor: '#3498db' }}
              onClick={openEmailAlberto}>
              Invia Alberto
            </Button>
            <Button icon={<WhatsAppOutlined />}
              style={{ background: '#25D366', color: '#fff', borderColor: '#25D366' }}
              onClick={openWhatsApp} disabled={!addr.phoneClean}>
              WhatsApp
            </Button>
          </Space>
        </>
      )}

      {/* ── Tab SHIPPED ── */}
      {tab === 'ship' && (
        <Form form={shipForm} layout="vertical" onFinish={(v) => shipMut.mutate(v)}>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item label="Tracking Number" name="tracking"
                rules={[{ required: true, message: 'Obbligatorio' }]}>
                <Input placeholder="es. 3S12345678901234 / 1Z999AA10123456784" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Peso pacco (kg)" name="peso">
                <InputNumber style={{ width: '100%' }} step={0.1} min={0} placeholder="0.5" />
              </Form.Item>
            </Col>
          </Row>

          {isEconomy && (
            <Form.Item label="Vettore (Economy)">
              <Checkbox.Group value={carriers} onChange={(v) => setCarriers(v as string[])}>
                <Checkbox value="PostNL">PostNL</Checkbox>
                <Checkbox value="BRT">BRT</Checkbox>
                <Checkbox value="UPS">UPS</Checkbox>
              </Checkbox.Group>
            </Form.Item>
          )}

          <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
            Verrà inviato un messaggio al buyer con il link di tracking.<br />
            Il sistema rileva il corriere dal formato del numero (3S=PostNL, 1Z=UPS, 13 cifre=BRT).
          </Text>

          <Space>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />}
              loading={shipMut.isPending}>Segna come Shipped</Button>
            <Button icon={<MailOutlined />}
              style={{ background: '#3498db', color: '#fff', borderColor: '#3498db' }}
              onClick={openEmailAlberto}>Invia Alberto</Button>
          </Space>
        </Form>
      )}

      {/* ── Tab CANCELLA ── */}
      {tab === 'cancel' && (
        <Form form={cancelForm} layout="vertical" onFinish={(v) => cancelMut.mutate(v)}>
          <Form.Item label="Motivo" name="reason" rules={[{ required: true }]}
            initialValue="Buyer requested cancellation">
            <Select options={[
              'Buyer requested cancellation', 'Item not available',
              'Per buyer request', 'Shipping issue', 'Payment issue', 'Other',
            ].map(v => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item label="Note aggiuntive (opzionale)" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Button danger htmlType="submit" icon={<CloseCircleOutlined />}
            loading={cancelMut.isPending}>
            Conferma Cancellazione
          </Button>
        </Form>
      )}
    </Modal>
  )
}

// ── Pagina principale ──────────────────────────────────────────────────────────

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const y = new Date().getFullYear()
  const m = String(i + 1).padStart(2, '0')
  return { value: `${y}-${m}`, label: dayjs(`${y}-${m}-01`).format('MMMM YYYY') }
})

export default function DiscogsOrdersPage() {
  const year = new Date().getFullYear()
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'))
  const [selected, setSelected] = useState<Order | null>(null)
  const qc = useQueryClient()

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['discogs-orders-year', year],
    queryFn: () => loadYear(year),
    staleTime: 5 * 60 * 1000,
  })

  const monthOrders = useMemo<Order[]>(() => {
    if (!data?.orders) return []
    return data.orders.filter(o => (o.created || '').startsWith(month))
  }, [data, month])

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

  const columns = buildColumns()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🎵 Ordini Discogs {year}</h2>
        <Select value={month} onChange={setMonth} style={{ width: 160 }} options={MONTHS} />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>Aggiorna</Button>
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
            <Card size="small" styles={{ body: { padding: '8px 12px', textAlign: 'center' } }}>
              <div style={{ fontSize: 10, color: '#666', fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
            </Card>
          </Col>
        ))}
      </Row>

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

      <OrderModal
        order={selected}
        onClose={() => setSelected(null)}
        onRefresh={() => qc.invalidateQueries({ queryKey: ['discogs-orders-year', year] })}
      />
    </div>
  )
}
