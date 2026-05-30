import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Button, Tag, Space, message } from 'antd'
import { PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import client from '@/api/client'

async function getSessions() {
  const res = await client.get('/api/v1/sessions', { params: { limit: 30 } })
  return res.data
}

async function getActiveSession() {
  const res = await client.get('/api/v1/sessions/active')
  return res.data
}

export default function SessionsTab() {
  const qc = useQueryClient()
  const { data: sessions, isLoading } = useQuery({ queryKey: ['sessions'], queryFn: getSessions })
  const { data: active } = useQuery({ queryKey: ['sessions', 'active'], queryFn: getActiveSession })

  const openMut = useMutation({
    mutationFn: (saldo: number) =>
      client.post('/api/v1/sessions/open', {
        saldo_effettivo_apertura: saldo,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      message.success('Sessione aperta')
    },
  })

  const columns = [
    { title: 'Apertura', dataIndex: 'data_apertura', render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'), width: 160 },
    { title: 'Chiusura', dataIndex: 'data_chiusura', render: (v: string | null) => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : <Tag color="green">Aperta</Tag>, width: 160 },
    { title: 'Saldo Apertura', dataIndex: 'saldo_effettivo_apertura', render: (v: number) => `${Number(v ?? 0).toFixed(2)} €`, width: 130 },
    { title: 'Saldo Chiusura', dataIndex: 'saldo_effettivo_chiusura', render: (v: number) => v != null ? `${Number(v).toFixed(2)} €` : '—', width: 130 },
    { title: 'Differenza', dataIndex: 'differenza', render: (v: number) => v != null ? `${Number(v).toFixed(2)} €` : '—', width: 110 },
    { title: 'Utente', dataIndex: 'utente', width: 100 },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        {!active ? (
          <Button
            icon={<PlayCircleOutlined />}
            type="primary"
            style={{ background: '#27ae60' }}
            onClick={() => openMut.mutate(0)}
          >
            Apri Sessione
          </Button>
        ) : (
          <Tag color="green" style={{ padding: '4px 12px', fontSize: 14 }}>
            Sessione #{active.id} aperta
          </Tag>
        )}
      </Space>
      <Table
        dataSource={sessions ?? []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 20 }}
      />
    </div>
  )
}
