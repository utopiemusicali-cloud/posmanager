import { useQuery } from '@tanstack/react-query'
import { Table, Tag } from 'antd'
import dayjs from 'dayjs'
import client from '@/api/client'

export default function ClosuresTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['closures'],
    queryFn: async () => {
      const res = await client.get('/api/v1/closures', { params: { limit: 50 } })
      return res.data
    },
  })

  const columns = [
    { title: 'Data', dataIndex: 'closure_ts', render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'), width: 160 },
    { title: 'Tipo', dataIndex: 'tipo', render: (v: string) => <Tag>{v}</Tag>, width: 100 },
    { title: 'Saldo Contabile', dataIndex: 'saldo_contabile', render: (v: number) => `${Number(v).toFixed(2)} €`, width: 140 },
    { title: 'Effettivo Cassa', dataIndex: 'effettivo_cassa', render: (v: number) => `${Number(v).toFixed(2)} €`, width: 140 },
    { title: 'Differenza', dataIndex: 'differenza', render: (v: number) => <Tag color={Number(v) === 0 ? 'green' : 'orange'}>{Number(v).toFixed(2)} €</Tag>, width: 110 },
    { title: 'Utente', dataIndex: 'utente', width: 100 },
    { title: 'Note', dataIndex: 'note' },
  ]

  return (
    <Table
      dataSource={data ?? []}
      columns={columns}
      rowKey="id"
      loading={isLoading}
      size="small"
      pagination={{ pageSize: 20 }}
    />
  )
}
