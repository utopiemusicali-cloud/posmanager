import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Table, Input, Button, InputNumber, AutoComplete,
  Row, Col, Card, Tag, Space, Divider, message, Popconfirm,
  Typography, Tooltip, Select,
} from 'antd'
import type { InputRef } from 'antd'
import type { ColumnType } from 'antd/es/table'
import {
  BarcodeOutlined, PlusOutlined, DeleteOutlined,
  SaveOutlined, ClearOutlined, UserOutlined, SearchOutlined,
} from '@ant-design/icons'
import client from '@/api/client'
import dayjs from 'dayjs'

const { Text, Title } = Typography

// ── Tipi ──────────────────────────────────────────────────────────────────────

interface InvItem {
  listing_id: string
  source: string
  artist: string
  title: string
  label: string
  catno: string
  format: string
  price: string
  media_condition: string
  sleeve_condition: string
  location: string
  external_id: string
  status: string
}

interface CartItem {
  _key: string
  listing_id: string
  source: string
  artist: string
  title: string
  catno: string
  format: string
  price: number
  qn: boolean
}

interface PaymentSplit {
  metodo: string
  importo: number
}

interface Customer { id: number; nome: string; tel: string | null; mail: string | null }

const METODI = ['Contanti', 'SumUp', 'PayPal']
const METODO_EMOJI: Record<string, string> = {
  Contanti: '💵',
  SumUp: '💳',
  PayPal: '🅿️',
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function searchInventory(q: string) {
  const res = await client.get('/api/v1/inventory', {
    params: { status: 'For Sale', q: q || undefined, page: 1, page_size: 80 },
  })
  return (res.data.items ?? []) as InvItem[]
}

async function getNextNumber() {
  const res = await client.get('/api/v1/receipts/next-number')
  return res.data.numero as number
}

async function searchCustomers(q: string) {
  const res = await client.get('/api/v1/customers', { params: { q, page: 1, page_size: 10 } })
  return (res.data.items ?? []) as Customer[]
}

async function saveReceipt(payload: object) {
  const res = await client.post('/api/v1/receipts', payload)
  return res.data
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePrice(v: string): number {
  return parseFloat(String(v ?? '0').replace(',', '.')) || 0
}

function calcTotals(cart: CartItem[], pct: number, bonus: number) {
  const sub = cart.reduce((s, i) => s + i.price, 0)
  const disc = cart.filter(i => i.qn).reduce((s, i) => s + i.price * pct / 100, 0)
  const total = sub - disc
  const totalPaid = Math.max(0, total - bonus)
  return { sub, disc, total, totalPaid, dItems: cart.filter(i => i.qn).length }
}

// ── Sezione Split Pagamento ────────────────────────────────────────────────────

function SplitPaymentSection({
  payments,
  onChange,
  totalPaid,
}: {
  payments: PaymentSplit[]
  onChange: (p: PaymentSplit[]) => void
  totalPaid: number
}) {
  const allocated = payments.reduce((s, p) => s + (p.importo || 0), 0)
  const missing = Math.round((totalPaid - allocated) * 100) / 100
  const ok = Math.abs(missing) < 0.01

  function setMetodo(idx: number, metodo: string) {
    onChange(payments.map((p, i) => i === idx ? { ...p, metodo } : p))
  }
  function setImporto(idx: number, importo: number) {
    onChange(payments.map((p, i) => i === idx ? { ...p, importo } : p))
  }
  function remove(idx: number) {
    onChange(payments.filter((_, i) => i !== idx))
  }
  function add() {
    const nextMetodo = METODI.find(m => !payments.some(p => p.metodo === m)) ?? METODI[0]
    const nextImporto = Math.max(0, Math.round(missing * 100) / 100)
    onChange([...payments, { metodo: nextMetodo, importo: nextImporto }])
  }

  // Quick-select: imposta un singolo pagamento con l'intero importo
  function quickSet(metodo: string) {
    onChange([{ metodo, importo: Math.round(totalPaid * 100) / 100 }])
  }

  return (
    <div>
      <Text strong>Pagamento:</Text>

      {/* Quick select (singolo metodo) */}
      <div style={{ display: 'flex', gap: 6, marginTop: 6, marginBottom: 8 }}>
        {METODI.map(m => {
          const active = payments.length === 1 && payments[0].metodo === m
          return (
            <Button
              key={m}
              size="small"
              type={active ? 'primary' : 'default'}
              onClick={() => quickSet(m)}
            >
              {METODO_EMOJI[m]} {m}
            </Button>
          )
        })}
      </div>

      {/* Righe split */}
      {payments.map((p, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <Select
            value={p.metodo}
            onChange={v => setMetodo(idx, v)}
            style={{ width: 120 }}
            options={METODI.map(m => ({ value: m, label: `${METODO_EMOJI[m]} ${m}` }))}
            size="small"
          />
          <InputNumber
            value={p.importo}
            onChange={v => setImporto(idx, Number(v ?? 0))}
            min={0}
            step={0.5}
            precision={2}
            prefix="€"
            size="small"
            style={{ flex: 1 }}
          />
          {payments.length > 1 && (
            <Button
              size="small"
              danger
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => remove(idx)}
            />
          )}
        </div>
      ))}

      {/* Aggiungi metodo */}
      <Button
        size="small"
        type="dashed"
        icon={<PlusOutlined />}
        onClick={add}
        style={{ width: '100%', marginBottom: 6 }}
      >
        Aggiungi metodo
      </Button>

      {/* Stato allocazione */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: ok ? '#f6ffed' : '#fff1f0',
        border: `1px solid ${ok ? '#b7eb8f' : '#ffa39e'}`,
        borderRadius: 4, padding: '4px 8px', fontSize: 12,
      }}>
        <Text style={{ fontSize: 12 }}>
          Allocato: <b>€ {allocated.toFixed(2)}</b> / € {totalPaid.toFixed(2)}
        </Text>
        {ok
          ? <Text style={{ color: '#52c41a', fontSize: 12 }}>✓ Completo</Text>
          : <Text style={{ color: '#f5222d', fontSize: 12 }}>
              {missing > 0 ? `Mancante: € ${missing.toFixed(2)}` : `Eccesso: € ${Math.abs(missing).toFixed(2)}`}
            </Text>
        }
      </div>
    </div>
  )
}

// ── Colonne inventario ─────────────────────────────────────────────────────────

const invColumns: ColumnType<InvItem>[] = [
  { title: 'Fonte', dataIndex: 'source', width: 80, render: (v: string) => <Tag>{v}</Tag> },
  { title: 'ID', dataIndex: 'listing_id', width: 90, ellipsis: true },
  { title: 'Artista / Titolo', key: 'at', ellipsis: true,
    render: (_: unknown, r: InvItem) => <><b>{r.artist}</b> — {r.title}</> },
  { title: 'Cat#', dataIndex: 'catno', width: 80, ellipsis: true },
  { title: 'Prezzo', dataIndex: 'price', width: 75, align: 'right' as const,
    render: (v: string) => `€ ${parsePrice(v).toFixed(2)}` },
  { title: 'Media', dataIndex: 'media_condition', width: 120, ellipsis: true },
]

// ── Colonne carrello ───────────────────────────────────────────────────────────

function cartColumns(
  pct: number,
  onToggleQn: (key: string) => void,
  onRemove: (key: string) => void,
): ColumnType<CartItem>[] {
  return [
    { title: 'Artista / Titolo', key: 'at', ellipsis: true,
      render: (_: unknown, r: CartItem) => (
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>{r.artist}</div>
          <div style={{ color: '#888', fontSize: 11 }}>{r.title}</div>
          <div style={{ color: '#aaa', fontSize: 10 }}>{r.catno} · {r.format}</div>
        </div>
      )},
    { title: 'Base', dataIndex: 'price', width: 70, align: 'right' as const,
      render: (v: number) => `€ ${v.toFixed(2)}` },
    { title: 'QN', key: 'qn', width: 52, align: 'center' as const,
      render: (_: unknown, r: CartItem) => (
        <Tooltip title={r.qn ? 'Sconto attivo — clicca per disattivare' : 'Clicca per applicare sconto'}>
          <button onClick={() => onToggleQn(r._key)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 0 }}>
            {r.qn ? '🟢' : '⚪'}
          </button>
        </Tooltip>
      )},
    { title: 'Prezzo', key: 'dp', width: 72, align: 'right' as const,
      render: (_: unknown, r: CartItem) => {
        const dp = r.qn ? r.price * (1 - pct / 100) : r.price
        return <span style={{ color: r.qn ? '#27ae60' : undefined, fontWeight: 600 }}>€ {dp.toFixed(2)}</span>
      }},
    { key: 'del', width: 36, align: 'center' as const,
      render: (_: unknown, r: CartItem) => (
        <Button size="small" danger type="text" icon={<DeleteOutlined />}
          onClick={() => onRemove(r._key)} />
      )},
  ]
}

// ── Componente principale ─────────────────────────────────────────────────────

export default function ReceiptPage() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [pct, setPct] = useState(0)
  const [bonus, setBonus] = useState(0)
  const [payments, setPayments] = useState<PaymentSplit[]>([{ metodo: 'Contanti', importo: 0 }])
  const [cliente, setCliente] = useState('')
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerOptions, setCustomerOptions] = useState<{value:string;label:string;id:number}[]>([])

  const [invSearch, setInvSearch] = useState('')
  const [barcode, setBarcode] = useState('')
  const barcodeRef = useRef<InputRef>(null)

  const { data: invItems = [], isLoading: invLoading } = useQuery({
    queryKey: ['inv-pos', invSearch],
    queryFn: () => searchInventory(invSearch),
    staleTime: 30_000,
  })

  const { data: nextNum } = useQuery({
    queryKey: ['next-receipt-number'],
    queryFn: getNextNumber,
  })

  const saveMut = useMutation({
    mutationFn: saveReceipt,
    onSuccess: () => {
      message.success('Ricevuta salvata!')
      setCart([])
      setPct(0)
      setBonus(0)
      setPayments([{ metodo: 'Contanti', importo: 0 }])
      setCliente('')
      setCustomerId(null)
    },
    onError: () => message.error('Errore durante il salvataggio'),
  })

  useEffect(() => { barcodeRef.current?.focus() }, [])

  const { sub, disc, total, totalPaid, dItems } = calcTotals(cart, pct, bonus)

  // Aggiorna l'importo del singolo metodo quando cambia il totale (single-payment)
  useEffect(() => {
    if (payments.length === 1) {
      setPayments([{ ...payments[0], importo: Math.round(totalPaid * 100) / 100 }])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPaid])

  // ── Carrello ─────────────────────────────────────────────────────────────────

  function addToCart(item: InvItem) {
    const price = parsePrice(item.price)
    const key = `${item.listing_id}-${Date.now()}`
    setCart(c => [...c, {
      _key: key,
      listing_id: item.listing_id,
      source: item.source,
      artist: item.artist ?? '',
      title: item.title ?? '',
      catno: item.catno ?? '',
      format: item.format ?? '',
      price,
      qn: false,
    }])
    barcodeRef.current?.focus()
  }

  function addByBarcode() {
    const code = barcode.trim()
    if (!code) return
    const found = invItems.find(i => i.listing_id === code || i.external_id === code)
    if (found) {
      addToCart(found)
      setBarcode('')
    } else {
      client.get('/api/v1/inventory', {
        params: { status: 'For Sale', q: code, page: 1, page_size: 5 },
      }).then(r => {
        const items = r.data.items ?? []
        const exact = items.find((i: InvItem) => i.listing_id === code || i.external_id === code)
        if (exact) { addToCart(exact); setBarcode('') }
        else message.warning(`Articolo non trovato: ${code}`)
      })
    }
  }

  function toggleQn(key: string) {
    setCart(c => c.map(i => i._key === key ? { ...i, qn: !i.qn } : i))
  }

  function removeItem(key: string) {
    setCart(c => c.filter(i => i._key !== key))
  }

  // ── Cliente ───────────────────────────────────────────────────────────────────

  const handleCustomerSearch = async (q: string) => {
    setCliente(q)
    setCustomerId(null)
    if (q.length < 2) { setCustomerOptions([]); return }
    const res = await searchCustomers(q)
    setCustomerOptions(res.map(c => ({ value: c.nome, label: `${c.nome}${c.tel ? ' · ' + c.tel : ''}`, id: c.id })))
  }

  // ── Salva ─────────────────────────────────────────────────────────────────────

  function handleSave() {
    if (cart.length === 0) { message.warning('Carrello vuoto'); return }
    if (payments.length === 0) { message.warning('Seleziona il metodo di pagamento'); return }

    const allocated = payments.reduce((s, p) => s + (p.importo || 0), 0)
    if (Math.abs(allocated - totalPaid) > 0.01) {
      message.warning(`Importo allocato (€ ${allocated.toFixed(2)}) ≠ totale (€ ${totalPaid.toFixed(2)})`)
      return
    }
    if (!cliente.trim()) { message.warning('Inserisci il nome del cliente'); return }

    saveMut.mutate({
      receipt_ts: dayjs().toISOString(),
      numero_ricevuta: String(nextNum ?? ''),
      discount: disc.toFixed(2),
      bonus: bonus.toFixed(2),
      total_paid: totalPaid.toFixed(2),
      cliente: cliente.trim(),
      items: cart.length,
      d_items: dItems,
      customer_id: customerId,
      payments: payments.map(p => ({ metodo: p.metodo, importo: p.importo.toFixed(2) })),
    })
  }

  const columns = cartColumns(pct, toggleQn, removeItem)

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>🧾 Nuova Ricevuta</Title>
        {nextNum && <Tag color="blue">N° {nextNum}</Tag>}
      </div>

      <Row gutter={16} style={{ height: 'calc(100vh - 140px)' }}>

        {/* ── Pannello sinistro: Inventario ── */}
        <Col span={14} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          <Card size="small" style={{ flexShrink: 0 }}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                ref={barcodeRef}
                prefix={<BarcodeOutlined />}
                placeholder="Scansiona barcode o inserisci Listing ID / External ID..."
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                onPressEnter={addByBarcode}
                style={{ flex: 1 }}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={addByBarcode}>
                Aggiungi
              </Button>
            </Space.Compact>
          </Card>

          <Card size="small" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Cerca nell'inventario..."
              value={invSearch}
              onChange={e => setInvSearch(e.target.value)}
              style={{ marginBottom: 8 }}
              allowClear
            />
            <div style={{ flex: 1, overflow: 'auto' }}>
              <Table
                dataSource={invItems}
                columns={invColumns}
                rowKey={r => r.listing_id}
                loading={invLoading}
                size="small"
                pagination={false}
                scroll={{ y: 'calc(100vh - 340px)' }}
                onRow={r => ({
                  onClick: () => addToCart(r),
                  style: { cursor: 'pointer' },
                })}
                footer={() => (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {invItems.length} articoli · click per aggiungere al carrello
                  </Text>
                )}
              />
            </div>
          </Card>
        </Col>

        {/* ── Pannello destro: Carrello + pagamento ── */}
        <Col span={10} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          <Card
            size="small"
            title={<Space><span>🛒 Carrello</span><Tag>{cart.length} articoli</Tag></Space>}
            extra={
              cart.length > 0 && (
                <Popconfirm title="Svuotare il carrello?" onConfirm={() => setCart([])}>
                  <Button size="small" icon={<ClearOutlined />} danger>Svuota</Button>
                </Popconfirm>
              )
            }
            style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, overflow: 'auto', padding: '0' } }}
          >
            <Table
              dataSource={cart}
              columns={columns}
              rowKey="_key"
              size="small"
              pagination={false}
              scroll={{ y: 'calc(100vh - 520px)' }}
              rowClassName={r => r.qn ? 'row-discounted' : ''}
              locale={{ emptyText: 'Carrello vuoto — aggiungi articoli dall\'inventario' }}
            />
          </Card>

          {/* Sconto % */}
          <Card size="small" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text strong style={{ whiteSpace: 'nowrap' }}>% OFF:</Text>
              <InputNumber
                value={pct}
                onChange={v => setPct(Number(v ?? 0))}
                min={0} max={100} step={1}
                style={{ width: 70 }}
                addonAfter="%"
              />
              <Space.Compact>
                {[5, 10, 15, 20].map(p => (
                  <Button key={p} size="small" type={pct === p ? 'primary' : 'default'}
                    onClick={() => setPct(pct === p ? 0 : p)}>
                    {p}%
                  </Button>
                ))}
              </Space.Compact>
            </div>
          </Card>

          {/* Cliente + pagamento + totali */}
          <Card size="small" style={{ flexShrink: 0 }}>

            {/* Cliente */}
            <div style={{ marginBottom: 8 }}>
              <Text strong><UserOutlined /> Cliente:</Text>
              <AutoComplete
                options={customerOptions}
                value={cliente}
                onSearch={handleCustomerSearch}
                onSelect={(val, opt) => { setCliente(val); setCustomerId((opt as {id:number}).id) }}
                style={{ width: '100%', marginTop: 4 }}
              >
                <Input placeholder="Nome cliente (obbligatorio)" />
              </AutoComplete>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            {/* Totali */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', alignItems: 'center', marginBottom: 8 }}>
              <Text type="secondary">Subtotale:</Text>
              <Text style={{ textAlign: 'right' }}>€ {sub.toFixed(2)}</Text>

              <Text type="secondary">Sconto ({dItems} art.):</Text>
              <Text style={{ textAlign: 'right', color: disc > 0 ? '#e74c3c' : undefined }}>
                − € {disc.toFixed(2)}
              </Text>

              <Text type="secondary">Totale:</Text>
              <Text style={{ textAlign: 'right' }}>€ {total.toFixed(2)}</Text>

              <Text type="secondary">Bonus:</Text>
              <InputNumber
                value={bonus}
                onChange={v => setBonus(Number(v ?? 0))}
                min={0} step={0.5}
                style={{ width: '100%' }}
                prefix="€"
                size="small"
              />

              <Text strong style={{ fontSize: 16 }}>TOTALE:</Text>
              <Text strong style={{ fontSize: 20, textAlign: 'right', color: '#27ae60' }}>
                € {totalPaid.toFixed(2)}
              </Text>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            {/* Split pagamento */}
            <SplitPaymentSection
              payments={payments}
              onChange={setPayments}
              totalPaid={totalPaid}
            />

            <Divider style={{ margin: '8px 0' }} />

            <Button
              type="primary"
              size="large"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saveMut.isPending}
              disabled={cart.length === 0}
              style={{ width: '100%', height: 48, fontSize: 16, background: '#27ae60', borderColor: '#27ae60' }}
            >
              SALVA RICEVUTA
            </Button>
          </Card>
        </Col>
      </Row>

      <style>{`
        .row-discounted td { background: #f6ffed !important; }
        .row-discounted:hover td { background: #d9f7be !important; }
      `}</style>
    </div>
  )
}
