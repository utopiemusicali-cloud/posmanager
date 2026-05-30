import { useQuery } from '@tanstack/react-query'
import { Table, Card, Row, Col, Statistic } from 'antd'
import { FundOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import client from '@/api/client'

export default function CostCentersPage() {
  const { data: summary } = useQuery({
    queryKey: ['cost-centers', 'summary'],
    queryFn: async () => {
      const res = await client.get('/api/v1/cost-centers/summary')
      return res.data
    },
  })

  const { data: items, isLoading } = useQuery({
    queryKey: ['cost-centers', 'list'],
    queryFn: async () => {
      const res = await client.get('/api/v1/cost-centers', { params: { limit: 200 } })
      return res.data
    },
  })

  const columns = [
    { title: 'Data', dataIndex: 'data', render: (v: string) => dayjs(v).format('DD/MM/YYYY'), width: 110 },
    { title: 'Categoria', dataIndex: 'categoria', width: 120 },
    { title: 'Importo', dataIndex: 'importo', render: (v: number) => `${Number(v).toFixed(2)} €`, width: 110 },
    { title: 'Nota', dataIndex: 'nota' },
    { title: 'Utente', dataIndex: 'utente', width: 100 },
  ]

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>📁 Centro Costi</h2>

      {summary && (
        <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
          {summary.map((s: { categoria: string; totale: number }) => (
            <Col key={s.categoria}>
              <Card size="small" style={{ minWidth: 130 }}>
                <Statistic
                  title={s.categoria}
                  value={Number(s.totale).toFixed(2)}
                  suffix="€"
                  prefix={<FundOutlined />}
                  valueStyle={{ fontSize: 14 }}
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Table
        dataSource={items ?? []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 50 }}
      />
    </div>
  )
}
