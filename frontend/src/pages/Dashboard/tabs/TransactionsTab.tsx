import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import dayjs from 'dayjs'
import client from '@/api/client'

interface Props { fonte: string }

export default function TransactionsTab({ fonte }: Props) {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', fonte, page],
    queryFn: async () => {
      const res = await client.get('/api/v1/transactions', { params: { fonte, page, page_size: 50 } })
      return res.data
    },
  })

  // SumUp e PayPal salvano stati gia' normalizzati in italiano: il colore
  // dipende dall'esito, non dalla fonte.
  const statoColor = (v: string) => {
    if (['Completata', 'SUCCESSFUL', 'Completed'].includes(v)) return 'green'
    if (['Fallita', 'Negata', 'Annullata'].includes(v)) return 'red'
    if (['Stornata', 'Rimborsata'].includes(v)) return 'purple'
    return 'orange'
  }

  const columns = [
    { title: 'Data', dataIndex: 'data', render: (v: string) => dayjs(v).format('DD/MM/YYYY'), width: 110 },
    { title: 'ID', dataIndex: 'transaction_id', width: 160 },
    { title: 'Tipo', dataIndex: 'tipo', width: 100 },
    { title: 'Stato', dataIndex: 'stato', render: (v: string) => <Tag color={statoColor(v)}>{v || '—'}</Tag>, width: 110 },
    { title: 'Carta', dataIndex: 'carta', width: 120 },
    { title: 'Importo', dataIndex: 'importo', render: (v: number) => `${Number(v ?? 0).toFixed(2)} €`, width: 100 },
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
        showTotal: (t) => `${t} transazioni ${fonte}`,
      }}
    />
  )
}
