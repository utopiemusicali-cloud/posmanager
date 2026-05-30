import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table, Select, Tag, Button, Modal, Form, Input, InputNumber,
  Row, Col, Card, Descriptions, Space, Checkbox, Alert,
  message, Typography, Spin, Divider, Tooltip,
} from 'antd'
import type { ColumnType } from 'antd/es/table'
import {
  ReloadOutlined, SendOutlined, CloseCircleOutlined,
  PrinterOutlined, MailOutlined, WhatsAppOutlined,
  CheckCircleFilled, CloseCircleFilled,
  LeftOutlined, RightOutlined,
} from '@ant-design/icons'
import client from '@/api/client'
import dayjs from 'dayjs'

const { Link, Text } = Typography

// ── Tipi ──────────────────────────────────────────────────────────────────────

interface OrderItem {
  release?: {
    id: number
    description: string
    thumbnail?: string
    uri?: string
  }
  price?: { value: number; currency: string }
  media_condition?: string
  sleeve_condition?: string
  format?: string
  location?: string
  id?: number
}

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
  items: OrderItem[]
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
    if (l.toLowerCase().startsWith('paypal')) paypal = l.replace(/paypal[^:]*:/i, '').trim()
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (!l.startsWith('Phone:') && !l.toLowerCase().startsWith('paypal')) { country = l; break }
  }
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

// ── Modal dettaglio ────────────────────────────────────────────────────────────

// ── Gallery foto release ───────────────────────────────────────────────────────

interface GalleryPhoto { uri: string; thumb: string }

function PhotoGallery({ releaseId, title, onClose }: {
  releaseId: number; title: string; onClose: () => void
}) {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    setLoading(true)
    setIdx(0)
    client.get(`/api/v1/integrations/discogs/releases/${releaseId}/images`)
      .then(r => setPhotos(r.data.images ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [releaseId])

  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), [])
  const next = useCallback(() => setIdx(i => Math.min(photos.length - 1, i + 1)), [photos.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prev, next, onClose])

  const current = photos[idx]

  return (
    <Modal open title={title} onCancel={onClose} footer={null} width={720} centered>
      {loading && <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>}
      {!loading && photos.length === 0 && <Text type="secondary">Nessuna immagine disponibile</Text>}
      {!loading && current && (
        <>
          {/* Immagine principale con frecce overlay */}
          <div style={{ position: 'relative', textAlign: 'center', userSelect: 'none' }}>
            {/* Freccia sinistra — vicina all'immagine */}
            {idx > 0 && (
              <button onClick={prev} style={{
                position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                zIndex: 10, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                width: 38, height: 38, cursor: 'pointer', color: '#fff', fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <LeftOutlined />
              </button>
            )}

            <img
              src={current.uri}
              alt={title}
              onClick={() => setZoom(z => !z)}
              onWheel={e => {
                if (e.deltaY < 0) setZoom(true)
                else setZoom(false)
              }}
              style={{
                maxWidth: zoom ? '150%' : '100%',
                maxHeight: zoom ? 'none' : 520,
                objectFit: 'contain',
                cursor: zoom ? 'zoom-out' : 'zoom-in',
                borderRadius: 8,
                transition: 'max-width 0.2s',
              }}
            />

            {/* Freccia destra — vicina all'immagine */}
            {idx < photos.length - 1 && (
              <button onClick={next} style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                zIndex: 10, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                width: 38, height: 38, cursor: 'pointer', color: '#fff', fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <RightOutlined />
              </button>
            )}
          </div>

          {/* Contatore + thumbnails */}
          <div style={{ textAlign: 'center', marginTop: 12, color: '#888', fontSize: 12 }}>
            {idx + 1} / {photos.length} · scroll o click per zoom · ← → frecce tastiera
          </div>
          {photos.length > 1 && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              {photos.map((p, i) => (
                <img key={i} src={p.thumb} alt=""
                  onClick={() => setIdx(i)}
                  style={{
                    width: 52, height: 52, objectFit: 'cover', borderRadius: 4, cursor: 'pointer',
                    border: i === idx ? '2px solid #1677ff' : '2px solid transparent',
                    opacity: i === idx ? 1 : 0.6,
                    transition: 'opacity 0.15s',
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}


// ── Modal dettaglio ordine ─────────────────────────────────────────────────────

function OrderModal({ order, onClose, onRefresh }: {
  order: Order | null; onClose: () => void; onRefresh: () => void
}) {
  const [shipForm] = Form.useForm()
  const [cancelForm] = Form.useForm()
  const [tab, setTab] = useState<'info' | 'ship' | 'cancel' | 'messages'>('info')
  const [focusedItem, setFocusedItem] = useState(0)
  const [gallery, setGallery] = useState<{id:number;title:string}|null>(null)
  const [messages, setMessages] = useState<Array<{from:{username:string};message:string;timestamp:string}>>([])
  const [msgLoading, setMsgLoading] = useState(false)
  const [msgText, setMsgText] = useState('')
  const [msgSending, setMsgSending] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const [carriers, setCarriers] = useState<string[]>([])
  // Spunte per ogni item: true = presente, false = mancante
  const [present, setPresent] = useState<Record<number, boolean>>({})

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

  // Scroll all'item selezionato via frecce
  useEffect(() => {
    document.getElementById(`order-item-${focusedItem}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedItem])

  // Reset spunte quando cambia ordine
  const initPresent = useMemo(() => {
    const m: Record<number, boolean> = {}
    order?.items?.forEach((_, i) => { m[i] = true })
    return m
  }, [order])

  const currentPresent = Object.keys(present).length === 0 ? initPresent : present

  const missingItems = order?.items?.filter((_, i) => currentPresent[i] === false) ?? []
  const hasMissing = missingItems.length > 0

  // Carica messaggi quando si apre il tab messaggi
  useEffect(() => {
    if (tab !== 'messages' || !order) return
    setMsgLoading(true)
    client.get(`/api/v1/integrations/discogs/orders/${order.id}/messages`)
      .then(r => { setMessages(r.data.messages ?? []); setTimeout(() => chatBottomRef.current?.scrollIntoView(), 100) })
      .catch(() => message.error('Errore caricamento messaggi'))
      .finally(() => setMsgLoading(false))
  }, [tab, order])

  const sendMessage = async () => {
    if (!msgText.trim() || !order) return
    setMsgSending(true)
    try {
      await client.post(`/api/v1/integrations/discogs/orders/${order.id}/messages`, { message: msgText })
      setMsgText('')
      // Ricarica messaggi
      const r = await client.get(`/api/v1/integrations/discogs/orders/${order.id}/messages`)
      setMessages(r.data.messages ?? [])
      setTimeout(() => chatBottomRef.current?.scrollIntoView(), 100)
    } catch { message.error('Errore invio messaggio') }
    finally { setMsgSending(false) }
  }

  if (!order) return null

  const addr = parseAddr(order.shipping_address)
  const orderSuffix = order.id.includes('-') ? order.id.split('-').pop() : order.id.slice(-3)
  const buyerEmail = (order as any)['buyer.email'] || addr.paypal || ''
  const isEconomy = (order['shipping.method'] || '').toLowerCase().includes('economy')
  const isCancelled = order.status.includes('Cancelled')
  const isShipped = order.status === 'Shipped'

  const togglePresent = (i: number) => {
    setPresent(p => ({ ...initPresent, ...p, [i]: !(p[i] ?? true) }))
  }

  // Link actions
  const openEmailBuyer = () => {
    if (!buyerEmail) { message.warning('Email buyer non trovata'); return }
    window.open(`mailto:${buyerEmail}?subject=Order ${order.id}&body=Hello%2C%0A%0ARegarding your Discogs order ${order.id}.%0A%0ABest regards`, '_blank')
  }

  const openEmailAlberto = () => {
    const pesoVal = (shipForm.getFieldValue('peso') || 'N/D') + ' kg'
    const corpo = `${addr.country}, ${pesoVal}, ${order['shipping.method']}\n\n${addr.lines.join('\n')}`
    window.open(`mailto:aen@live.it?subject=SPED-${orderSuffix}&body=${encodeURIComponent(corpo)}`, '_blank')
  }

  const openWhatsApp = () => {
    if (!addr.phoneClean) { message.warning('Numero non trovato'); return }
    const msg = encodeURIComponent(`Ciao! Il tuo ordine Discogs ${order.id} è stato spedito.`)
    window.open(`https://wa.me/${addr.phoneClean}?text=${msg}`, '_blank')
  }

  const notifyMissingWhatsApp = () => {
    if (!addr.phoneClean) { message.warning('Numero non trovato'); return }
    const names = missingItems.map(it => it.release?.description ?? 'Articolo').join(', ')
    const msg = encodeURIComponent(`Ciao! Per il tuo ordine Discogs ${order.id} purtroppo i seguenti articoli non sono disponibili: ${names}. Ti contatteremo per trovare una soluzione.`)
    window.open(`https://wa.me/${addr.phoneClean}?text=${msg}`, '_blank')
  }

  const notifyMissingEmail = () => {
    if (!buyerEmail) { message.warning('Email non trovata'); return }
    const names = missingItems.map(it => it.release?.description ?? 'Articolo').join(', ')
    const body = `Hello,\n\nRegarding your Discogs order ${order.id}, unfortunately the following item(s) are not available:\n\n${names}\n\nWe will contact you to find a solution.\n\nBest regards`
    window.open(`mailto:${buyerEmail}?subject=Order ${order.id} - Item availability&body=${encodeURIComponent(body)}`, '_blank')
  }

  // Tutti i pulsanti in alto
  const topButtons = (
    <Space wrap style={{ marginBottom: 16 }}>
      <Button icon={<MailOutlined />}
        style={{ background: '#e67e22', color: '#fff', borderColor: '#e67e22' }}
        onClick={openEmailBuyer} disabled={!buyerEmail}>Email Buyer</Button>
      <Button icon={<MailOutlined />}
        style={{ background: '#3498db', color: '#fff', borderColor: '#3498db' }}
        onClick={openEmailAlberto}>Invia Alberto</Button>
      <Button icon={<WhatsAppOutlined />}
        style={{ background: '#25D366', color: '#fff', borderColor: '#25D366' }}
        onClick={openWhatsApp} disabled={!addr.phoneClean}>WhatsApp</Button>
      <Button icon={<PrinterOutlined />} onClick={() =>
        window.open(`https://www.discogs.com/sell/order/prints?order_id=${order.id}`, '_blank')}>
        Print
      </Button>
      <Divider type="vertical" />
      <Button type={tab === 'ship' ? 'primary' : 'default'} icon={<SendOutlined />}
        disabled={isShipped || isCancelled}
        onClick={() => setTab('ship')}>Shipped</Button>
      <Button danger={tab !== 'cancel'} type={tab === 'cancel' ? 'primary' : 'default'}
        icon={<CloseCircleOutlined />}
        disabled={isCancelled}
        onClick={() => setTab('cancel')}>Cancella</Button>
      <Button type={tab === 'messages' ? 'primary' : 'default'}
        onClick={() => setTab('messages')}>💬 Messaggi</Button>
    </Space>
  )

  return (
    <Modal open={!!order} onCancel={() => { setPresent({}); setTab('info'); setFocusedItem(0); setMessages([]); setMsgText(''); setGallery(null); onClose() }}
      title={<Space>
        <span>Ordine {order.id}</span>
        <Tag color={STATUS_COLOR[order.status] ?? 'default'}>{order.status}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>{fmtDate(order.created)}</Text>
      </Space>}
      width={820} footer={null}>

      {/* Tutti i pulsanti in alto */}
      {topButtons}

      {/* Alert dischi mancanti */}
      {hasMissing && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }}
          message={`${missingItems.length} disco/i mancante/i — comunicare al cliente`}
          description={missingItems.map(it => it.release?.description ?? 'Articolo').join(' · ')}
          action={
            <Space direction="vertical" size="small">
              <Button size="small" danger onClick={notifyMissingEmail} disabled={!buyerEmail}
                icon={<MailOutlined />}>Email</Button>
              <Button size="small" onClick={notifyMissingWhatsApp} disabled={!addr.phoneClean}
                icon={<WhatsAppOutlined />} style={{ background: '#25D366', color: '#fff', borderColor: '#25D366' }}>
                WhatsApp
              </Button>
            </Space>
          }
        />
      )}

      {/* ── Tab selector ── */}
      {(tab === 'ship' || tab === 'cancel') && (
        <div style={{ marginBottom: 12 }}>
          <Button onClick={() => setTab('info')}>← Torna a Info</Button>
        </div>
      )}

      {/* ── Tab INFO ── */}
      {tab === 'info' && (
        <>
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
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

          {/* Articoli con foto gallery + spunta */}
          <Divider orientation="left" plain>
            Articoli ({order.items?.length ?? 0}) — clicca ✓/✗ per segnare disponibilità · foto per ingrandire
          </Divider>
            {(order.items || []).map((item, i) => {
              const isPresent = currentPresent[i] !== false
              const thumb = item.release?.thumbnail
              const releaseId = item.release?.id
              const releaseTitle = item.release?.description ?? ''
              return (
                <div id={`order-item-${i}`} key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 10,
                  padding: '10px 14px', borderRadius: 8,
                  background: isPresent ? '#f6ffed' : '#fff2f0',
                  border: `1px solid ${isPresent ? '#b7eb8f' : '#ffccc7'}`,
                }}>
                  {/* Solo thumbnail — click apre gallery del release */}
                  <div style={{ flexShrink: 0, width: 110, height: 110 }}>
                    {thumb ? (
                      <img src={thumb} alt=""
                        onClick={() => releaseId && setGallery({ id: releaseId, title: releaseTitle })}
                        style={{
                          width: 110, height: 110, objectFit: 'cover', borderRadius: 6,
                          cursor: releaseId ? 'zoom-in' : 'default',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                        }}
                        title="Clicca per vedere tutte le foto"
                      />
                    ) : (
                      <div style={{ width: 110, height: 110, background: '#f0f0f0', borderRadius: 6,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>
                        🎵
                      </div>
                    )}
                  </div>

                  {/* Info articolo */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.release?.description ?? '—'}
                    </div>
                    {/* Location in grande */}
                    {item.location && (
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1677ff', marginBottom: 4 }}>
                        📍 {item.location}
                      </div>
                    )}
                    {/* Campi in ordine: Sleeve · Media · Format · Price */}
                    <div style={{ fontSize: 12, color: '#555', lineHeight: 1.8 }}>
                      <span>Sleeve: <b>{item.sleeve_condition ?? '—'}</b></span>
                      <span style={{ margin: '0 8px', color: '#ccc' }}>|</span>
                      <span>Media: <b>{item.media_condition ?? '—'}</b></span>
                      {item.format && <>
                        <span style={{ margin: '0 8px', color: '#ccc' }}>|</span>
                        <span>Format: <b>{item.format}</b></span>
                      </>}
                      <span style={{ margin: '0 8px', color: '#ccc' }}>|</span>
                      <span>Price: <b>{fmtEur(item.price?.value, item.price?.currency)}</b></span>
                    </div>
                  </div>

                  {/* Spunta presente/mancante */}
                  <Tooltip title={isPresent ? 'Presente — clicca per segnare mancante' : 'Mancante — clicca per segnare presente'}>
                    <button onClick={() => togglePresent(i)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 34, lineHeight: 1, flexShrink: 0 }}>
                      {isPresent
                        ? <CheckCircleFilled style={{ color: '#52c41a' }} />
                        : <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
                    </button>
                  </Tooltip>
                </div>
              )
            })}

          {/* Indirizzo */}
          <Divider orientation="left" plain>Indirizzo Spedizione</Divider>
          <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
            {addr.lines.join('\n') || '—'}
          </pre>
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
            Rileva il corriere dal formato: 3S=PostNL · 1Z=UPS · 13 cifre=BRT
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
            loading={cancelMut.isPending}>Conferma Cancellazione</Button>
        </Form>
      )}

      {/* ── Tab MESSAGGI ── */}
      {tab === 'messages' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: 420 }}>
          {/* Area chat */}
          <div style={{ flex: 1, overflowY: 'auto', background: '#f8f9fa',
            borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #e8e8e8' }}>
            {msgLoading && <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>}
            {!msgLoading && messages.length === 0 && (
              <Text type="secondary">Nessun messaggio per questo ordine.</Text>
            )}
            {messages.map((m, i) => {
              const isSeller = m.from?.username !== order['buyer.username']
              return (
                <div key={i} style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: isSeller ? 'flex-end' : 'flex-start',
                  marginBottom: 12,
                }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>
                    {isSeller ? '(Tu) ' : ''}<b>{m.from?.username}</b> · {dayjs(m.timestamp).format('DD/MM HH:mm')}
                  </div>
                  <div style={{
                    maxWidth: '80%', padding: '8px 12px', borderRadius: 12,
                    background: isSeller ? '#1677ff' : '#fff',
                    color: isSeller ? '#fff' : '#333',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                    whiteSpace: 'pre-wrap', fontSize: 13,
                  }}>
                    {m.message}
                  </div>
                </div>
              )
            })}
            <div ref={chatBottomRef} />
          </div>

          {/* Input nuovo messaggio */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Input.TextArea
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
              placeholder="Scrivi un messaggio..."
              rows={2}
              style={{ flex: 1 }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            />
            <Space direction="vertical">
              <Button type="primary" icon={<SendOutlined />}
                loading={msgSending} onClick={sendMessage}
                disabled={!msgText.trim()}>
                Invia
              </Button>
              <Button size="small" onClick={() => {
                setMsgLoading(true)
                client.get(`/api/v1/integrations/discogs/orders/${order.id}/messages`)
                  .then(r => setMessages(r.data.messages ?? []))
                  .finally(() => setMsgLoading(false))
              }}>
                <ReloadOutlined />
              </Button>
            </Space>
          </div>
          <Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>
            Invio con Invio · nuova riga con Shift+Invio
          </Text>
        </div>
      )}

      {/* Gallery foto release */}
      {gallery && (
        <PhotoGallery
          releaseId={gallery.id}
          title={gallery.title}
          onClose={() => setGallery(null)}
        />
      )}
    </Modal>
  )
}

// ── Colonne tabella ────────────────────────────────────────────────────────────

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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🎵 Ordini Discogs {year}</h2>
        <Select value={month} onChange={setMonth} style={{ width: 160 }} options={MONTHS} />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>Aggiorna</Button>
        {isLoading && <Spin />}
      </div>

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
        columns={buildColumns()}
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
