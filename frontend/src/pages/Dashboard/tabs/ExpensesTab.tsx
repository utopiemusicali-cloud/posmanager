import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import dayjs from 'dayjs'
import client from '@/api/client'

async function getExpenses(page: number) {
  const res = await client.get('/api/v1/expenses', { params: { page, page_size: 50 } })
  return res.data
}

export default function ExpensesTab() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['expenses', page],
    queryFn: () => getExpenses(page),
  })

  const columns = [
    { title: 'Data', dataIndex: 'data', render: (v: string) => dayjs(v).format('DD/MM/YYYY'), width: 110 },
    { title: 'Tipo Spesa', dataIndex: 'tipo_spesa', width: 120 },
    { title: 'Fornitore', dataIndex: 'fornitore' },
    { title: 'Nota', dataIndex: 'nota' },
    { title: 'Metodo', dataIndex: 'metodo_pagamento', width: 100 },
    {
      title: 'Importo',
      dataIndex: 'importo',
      width: 110,
      render: (v: number) => <Tag color="red">{Number(v).toFixed(2)} €</Tag>,
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
        showTotal: (t) => `${t} spese`,
      }}
    />
  )
}
