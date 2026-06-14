import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table, Tag, Button, Modal, message } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { getReceipts } from '@/api/endpoints/receipts'
import client from '@/api/client'

// ── Tipi ────────────────────────────────────────────────────────────────────

interface ShopSettings {
  ragione_sociale: string
  indirizzo: string
  cap: string
  citta: string
  provincia: string
  telefono: string | null
  regime_fiscale: string
  note_piede: string | null
}

interface PaymentSplit {
  metodo: string
  importo: number
}

interface Receipt {
  id: number
  receipt_ts: string
  numero_ricevuta: string | null
  cliente: string | null
  items: number
  d_items: number
  discount: number
  bonus: number
  total_paid: number
  metodo_pagamento: string | null
  payments: PaymentSplit[]
}

const METODO_EMOJI: Record<string, string> = {
  Contanti: '💵',
  SumUp: '💳',
  PayPal: '🅿️',
}

// ── Scontrino ────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildReceiptText(r: Receipt, shop: ShopSettings): string {
  const W = 42
  const sep = '─'.repeat(W)
  const dashes = '- '.repeat(W / 2)
  const center = (s: string) =>
    s.padStart(Math.floor((W + s.length) / 2)).padEnd(W)
  const row = (label: string, value: string) =>
    label + value.padStart(W - label.length)

  const lines: string[] = [
    center(shop.ragione_sociale),
    center(shop.indirizzo),
    center(`${shop.cap} ${shop.citta} (${shop.provincia})`),
    ...(shop.telefono ? [center(shop.telefono)] : []),
    sep,
    center('R I C E V U T A'),
    ...(r.numero_ricevuta ? [center(`N° ${r.numero_ricevuta}`)] : []),
    center(dayjs(r.receipt_ts).format('DD/MM/YYYY HH:mm')),
    sep,
    ...(r.cliente ? [`Cliente: ${r.cliente}`] : []),
    dashes,
    ...(r.items > 0 ? [row('Articoli nuovi', `${r.items}`)] : []),
    ...(r.d_items > 0 ? [row('Articoli usati', `${r.d_items}`)] : []),
    ...(Number(r.discount) > 0 ? [row('Sconto', `-€ ${Number(r.discount).toFixed(2)}`)] : []),
    ...(Number(r.bonus) > 0 ? [row('Bonus', `-€ ${Number(r.bonus).toFixed(2)}`)] : []),
    sep,
    row('TOTALE', `€ ${Number(r.total_paid).toFixed(2)}`),
    sep,
    ...(r.payments && r.payments.length > 0
      ? [
          'Pagamento:',
          ...r.payments.map(
            p => `  ${METODO_EMOJI[p.metodo] ?? '•'} ${p.metodo.padEnd(12)} € ${Number(p.importo).toFixed(2)}`
          ),
        ]
      : r.metodo_pagamento
        ? [`Pagamento: ${r.metodo_pagamento}`]
        : []),
    sep,
    ...(shop.note_piede ? [center(shop.note_piede)] : []),
    center('Grazie per il vostro acquisto!'),
    sep,
  ]
  return lines.join('\n')
}

function buildPrintHtml(r: Receipt, shop: ShopSettings): string {
  const text = escHtml(buildReceiptText(r, shop))
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Ricevuta ${escHtml(r.numero_ricevuta ?? String(r.id))}</title>
<style>
  @media print { body{margin:0} @page{margin:4mm;size:80mm auto} }
  body{font-family:'Courier New',monospace;font-size:12px;line-height:1.4;padding:8px;background:white;color:#111}
  pre{font-family:inherit;font-size:inherit;white-space:pre;margin:0}
  button{display:block;margin:12px auto;padding:8px 24px;background:#1677ff;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px}
  @media print{button{display:none}}
</style></head><body>
<button onclick="window.print()">🖨️ Stampa</button>
<pre>${text}</pre>
</body></html>`
}

// ── Componente Modal stampa ──────────────────────────────────────────────────

function PrintModal({
  rec,
  shop,
  onClose,
}: {
  rec: Receipt | null
  shop: ShopSettings
  onClose: () => void
}) {
  if (!rec) return null

  function handlePrint() {
    const html = buildPrintHtml(rec!, shop)
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
    } else {
      message.warning(
        'Popup bloccato da Chrome. Abilita i popup per questo sito per stampare.'
      )
    }
  }

  const text = buildReceiptText(rec, shop)

  return (
    <Modal
      title={`Ricevuta ${rec.numero_ricevuta ?? rec.id}`}
      open
      onCancel={onClose}
      footer={
        <Button type="primary" icon={<PrinterOutlined />} onClick={handlePrint}>
          Stampa
        </Button>
      }
      width={480}
    >
      <pre
        style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 12,
          lineHeight: 1.4,
          background: '#fafafa',
          border: '1px solid #eee',
          borderRadius: 4,
          padding: '12px 16px',
          overflowX: 'auto',
          whiteSpace: 'pre',
          color: '#111',
          margin: 0,
        }}
      >
        {text}
      </pre>
    </Modal>
  )
}

// ── Tabella ricevute ─────────────────────────────────────────────────────────

export default function ReceiptsTab() {
  const [page, setPage] = useState(1)
  const [printRec, setPrintRec] = useState<Receipt | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['receipts', page],
    queryFn: () => getReceipts({ page, page_size: 50 }),
  })

  const { data: shopSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await client.get('/api/v1/settings')
      return res.data as ShopSettings
    },
  })

  const defaultShop: ShopSettings = {
    ragione_sociale: 'Il Mio Negozio',
    indirizzo: '',
    cap: '',
    citta: '',
    provincia: '',
    telefono: null,
    regime_fiscale: 'margine',
    note_piede: null,
  }

  const columns = [
    {
      title: 'Data',
      dataIndex: 'receipt_ts',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
      width: 150,
    },
    { title: 'N°', dataIndex: 'numero_ricevuta', width: 70 },
    { title: 'Cliente', dataIndex: 'cliente' },
    { title: 'Items', dataIndex: 'items', width: 70 },
    {
      title: 'Sconto',
      dataIndex: 'discount',
      render: (v: number) => `${Number(v).toFixed(2)} €`,
      width: 90,
    },
    {
      title: 'Totale',
      dataIndex: 'total_paid',
      render: (v: number) => <Tag color="green">{Number(v).toFixed(2)} €</Tag>,
      width: 100,
    },
    { title: 'Pagamento', dataIndex: 'metodo_pagamento', width: 100 },
    {
      title: '',
      width: 50,
      render: (_: unknown, rec: Receipt) => (
        <Button
          icon={<PrinterOutlined />}
          size="small"
          type="text"
          title="Stampa ricevuta"
          onClick={() => setPrintRec(rec)}
        />
      ),
    },
  ]

  return (
    <>
      <Table
        dataSource={data?.items ?? []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={{
          current: page,
          total: data?.total ?? 0,
          pageSize: 50,
          onChange: setPage,
          showTotal: (t) => `${t} ricevute`,
        }}
      />

      <PrintModal
        rec={printRec}
        shop={shopSettings ?? defaultShop}
        onClose={() => setPrintRec(null)}
      />
    </>
  )
}
