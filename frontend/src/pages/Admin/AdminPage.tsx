import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, Table, Button, Tag, Typography, Space, message } from 'antd'
import { EyeOutlined, ShopOutlined } from '@ant-design/icons'
import type { ColumnType } from 'antd/es/table'
import client from '@/api/client'
import { useAuthStore } from '@/store/auth'

const { Title, Text } = Typography

interface CompanyRow {
  id: number
  name: string
  db_name: string
  is_active: boolean
  user_count: number
}

export default function AdminPage() {
  const navigate = useNavigate()
  const { switchToCompany } = useAuthStore()

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['admin-companies'],
    queryFn: async () => {
      const r = await client.get('/api/v1/admin/companies')
      return r.data as CompanyRow[]
    },
  })

  const handleAccedi = async (company: CompanyRow) => {
    try {
      const r = await client.post(`/api/v1/admin/companies/${company.id}/view-token`)
      switchToCompany(r.data.access_token, r.data.company_name, r.data.company_id)
      navigate('/dashboard')
    } catch {
      message.error('Errore accesso azienda')
    }
  }

  const columns: ColumnType<CompanyRow>[] = [
    {
      title: 'Azienda', dataIndex: 'name', key: 'name',
      render: (v: string) => <b><ShopOutlined style={{ marginRight: 6 }} />{v}</b>,
    },
    { title: 'Database', dataIndex: 'db_name', key: 'db_name',
      render: (v: string) => <Text code>{v}</Text> },
    { title: 'Utenti', dataIndex: 'user_count', key: 'user_count', width: 80, align: 'center' as const },
    {
      title: 'Stato', dataIndex: 'is_active', key: 'is_active', width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Attiva' : 'Inattiva'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 130,
      render: (_: unknown, c: CompanyRow) => (
        <Button
          icon={<EyeOutlined />}
          size="small"
          onClick={() => handleAccedi(c)}
          disabled={!c.is_active}
        >
          Accedi
        </Button>
      ),
    },
  ]

  return (
    <div style={{ maxWidth: 800 }}>
      <Space style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>⚙️ Pannello Superadmin</Title>
      </Space>

      <Card title="Aziende" loading={isLoading}>
        <Table
          dataSource={companies}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
        />
      </Card>
    </div>
  )
}
