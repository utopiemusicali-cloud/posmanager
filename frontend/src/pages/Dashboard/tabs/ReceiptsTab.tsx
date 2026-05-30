import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import dayjs from 'dayjs'
import { getReceipts } from '@/api/endpoints/receipts'

export default function ReceiptsTab() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['receipts', page],
    queryFn: () => getReceipts({ page, page_size: 50 }),
  })

  const columns = [
    { title: 'Data', dataIndex: 'receipt_ts', render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'), width: 150 },
    { title: 'N°', dataIndex: 'numero_ricevuta', width: 70 },
    { title: 'Cliente', dataIndex: 'cliente' },
    { title: 'Items', dataIndex: 'items', width: 70 },
    { title: 'Sconto', dataIndex: 'discount', render: (v: number) => `${Number(v).toFixed(2)} €`, width: 90 },
    { title: 'Totale', dataIndex: 'total_paid', render: (v: number) => <Tag color="green">{Number(v).toFixed(2)} €</Tag>, width: 100 },
    { title: 'Pagamento', dataIndex: 'metodo_pagamento', width: 100 },
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
