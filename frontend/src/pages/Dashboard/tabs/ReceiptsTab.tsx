import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table, Tag, Button } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { getReceipts } from '@/api/endpoints/receipts'
import client from '@/api/client'

// ── Scontrino HTML ───────────────────────────────────────────────────────────

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

function buildReceiptHtml(r: Receipt, shop: ShopSettings): string {
  const lineWidth = 42
  const sep = '─'.repeat(lineWidth)
  const dashes = '- '.repeat(lineWidth / 2)

  const center = (s: string) => s.padStart(Math.floor((lineWidth + s.length) / 2)).padEnd(lineWidth)
  const row = (label: string, value: string) =>
    `${label}${value.padStart(lineWidth - label.length)}`

  const lines: string[] = [
    center(shop.ragione_sociale),
    center(`${shop.indirizzo}`),
    center(`${shop.cap} ${shop.citta} (${shop.provincia})`),
    shop.telefono ? center(shop.telefono) : '',
    sep,
    center('R I C E V U T A'),
    r.numero_ricevuta ? center(`N° ${r.numero_ricevuta}`) : '',
    center(dayjs(r.receipt_ts).format('DD/MM/YYYY HH:mm')),
    sep,
  ]

  if (r.cliente) lines.push(`Cliente: ${r.cliente}`)

  lines.push(dashes)
  if (r.items > 0) lines.push(row(`Articoli nuovi`, `${r.items}`))
  if (r.d_items > 0) lines.push(row(`Articoli usati`, `${r.d_items}`))

  if (Number(r.discount) > 0)
    lines.push(row(`Sconto`, `-€ ${Number(r.discount).toFixed(2)}`))
  if (Number(r.bonus) > 0)
    lines.push(row(`Bonus`, `-€ ${Number(r.bonus).toFixed(2)}`))

  lines.push(sep)
  lines.push(row('TOTALE', `€ ${Number(r.total_paid).toFixed(2)}`))
  lines.push(sep)

  // Pagamenti
  if (r.payments && r.payments.length > 0) {
    lines.push('Pagamento:')
    for (const p of r.payments) {
      const emoji = METODO_EMOJI[p.metodo] ?? '•'
      lines.push(`  ${emoji} ${p.metodo.padEnd(12)} € ${Number(p.importo).toFixed(2)}`)
    }
  } else if (r.metodo_pagamento) {
    lines.push(`Pagamento: ${r.metodo_pagamento}`)
  }

  lines.push(sep)
  if (shop.note_piede) lines.push(center(shop.note_piede))
  lines.push(center('Grazie per il vostro acquisto!'))
  lines.push(sep)

  const pre = lines.filter(l => l !== undefined).join('\n')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Ricevuta ${r.numero_ricevuta ?? r.id}</title>
<style>
  @media print {
    body { margin: 0; }
    @page { margin: 4mm; size: 80mm auto; }
    .no-print { display: none; }
  }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    line-height: 1.4;
    background: white;
    color: #111;
    margin: 0;
    padding: 8px;
  }
  pre {
    font-family: inherit;
    font-size: inherit;
    white-space: pre;
    margin: 0;
  }
  .btn-wrap {
    text-align: center;
    margin: 16px 0 8px;
  }
  button {
    padding: 8px 24px;
    font-size: 14px;
    cursor: pointer;
    background: #1677ff;
    color: white;
    border: none;
    border-radius: 4px;
  }
</style>
</head>
<body>
<div class="btn-wrap no-print">
  <button onclick="window.print()">🖨️ Stampa</button>
</div>
<pre>${pre}</pre>
</body>
</html>`
}

// ── Tabella ricevute ─────────────────────────────────────────────────────────

export default function ReceiptsTab() {
  const [page, setPage] = useState(1)

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

  function handlePrint(rec: Receipt) {
    const shop: ShopSettings = shopSettings ?? {
      ragione_sociale: 'Il Mio Negozio',
      indirizzo: '',
      cap: '',
      citta: '',
      provincia: '',
      telefono: null,
      regime_fiscale: 'margine',
      note_piede: null,
    }
    const html = buildReceiptHtml(rec, shop)
    const win = window.open('', '_blank', 'width=400,height=600')
    if (win) {
      win.document.write(html)
      win.document.close()
    }
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
          onClick={() => handlePrint(rec)}
        />
      ),
    },
  ]

  return (
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
  )
}
