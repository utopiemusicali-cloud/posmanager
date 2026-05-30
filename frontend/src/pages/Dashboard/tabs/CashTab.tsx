import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Button, Tag, Statistic, Card, Row, Col, Popconfirm, message } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { getMovimenti, getSaldo, deleteMovimento } from '@/api/endpoints/cassa'
import type { CashMovement } from '@/api/endpoints/cassa'

export default function CashTab() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)

  const { data: saldoData } = useQuery({
    queryKey: ['cassa', 'saldo'],
    queryFn: getSaldo,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['cassa', 'movimenti', page],
    queryFn: () => getMovimenti({ page, page_size: 50 }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteMovimento,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cassa'] })
      message.success('Movimento eliminato')
    },
  })

  const columns = [
    {
      title: 'Data',
      dataIndex: 'movement_ts',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
      width: 140,
    },
    { title: 'Nota', dataIndex: 'nota' },
    { title: 'Tipo', dataIndex: 'tipo_spesa', width: 110 },
    { title: 'Metodo', dataIndex: 'metodo_pagamento', width: 100 },
    {
      title: 'Importo',
      dataIndex: 'importo',
      width: 110,
      render: (v: number) => (
        <Tag color={v >= 0 ? 'green' : 'red'}>
          {v >= 0 ? '+' : ''}{Number(v).toFixed(2)} €
        </Tag>
      ),
    },
    {
      title: 'Saldo',
      dataIndex: 'saldo',
      width: 110,
      render: (v: number) => `${Number(v ?? 0).toFixed(2)} €`,
    },
    {
      title: '',
      width: 50,
      render: (_: unknown, rec: CashMovement) => (
        <Popconfirm
          title="Eliminare questo movimento?"
          onConfirm={() => deleteMut.mutate(rec.id)}
          okText="Sì"
          cancelText="No"
        >
          <Button icon={<DeleteOutlined />} size="small" danger type="text" />
        </Popconfirm>
      ),
    },
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col>
          <Card size="small">
            <Statistic
              title="Saldo Attuale"
              value={Number(saldoData?.saldo ?? 0).toFixed(2)}
              suffix="€"
              valueStyle={{ color: Number(saldoData?.saldo ?? 0) >= 0 ? '#27ae60' : '#e74c3c' }}
            />
          </Card>
        </Col>
      </Row>

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
          showTotal: (t) => `${t} movimenti`,
        }}
      />
    </div>
  )
}
