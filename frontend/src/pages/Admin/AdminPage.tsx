import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Card, Table, Button, Tag, Typography, Space, message,
  Modal, Form, Input, Drawer, Divider, Popconfirm, Tooltip,
} from 'antd'
import {
  EyeOutlined, ShopOutlined, PlusOutlined,
  SettingOutlined, PoweroffOutlined,
} from '@ant-design/icons'
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

interface CompanySettings {
  discogs_token: string | null
  discogs_username: string | null
  discogs_password: string | null
  sumup_api_key: string | null
  sumup_merchant_code: string | null
  paypal_client_id: string | null
  paypal_client_secret: string | null
}

export default function AdminPage() {
  const navigate = useNavigate()
  const { switchToCompany } = useAuthStore()
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [settingsCompany, setSettingsCompany] = useState<CompanyRow | null>(null)
  const [createForm] = Form.useForm()
  const [settingsForm] = Form.useForm()

  // ── Query ──────────────────────────────────────────────────────────────────

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['admin-companies'],
    queryFn: async () => {
      const r = await client.get('/api/v1/admin/companies')
      return r.data as CompanyRow[]
    },
  })

  const { data: tenantSettings, isFetching: settingsFetching } = useQuery({
    queryKey: ['admin-company-settings', settingsCompany?.id],
    queryFn: async () => {
      const r = await client.get(`/api/v1/admin/companies/${settingsCompany!.id}/settings`)
      return r.data as CompanySettings
    },
    enabled: !!settingsCompany,
  })

  // Popola il form quando arrivano le impostazioni del tenant
  useEffect(() => {
    if (!tenantSettings) return
    settingsForm.setFieldsValue({
      discogs_token: tenantSettings.discogs_token ?? '',
      discogs_username: tenantSettings.discogs_username ?? '',
      discogs_password: tenantSettings.discogs_password ?? '',
      sumup_api_key: tenantSettings.sumup_api_key ?? '',
      sumup_merchant_code: tenantSettings.sumup_merchant_code ?? '',
      paypal_client_id: tenantSettings.paypal_client_id ?? '',
      paypal_client_secret: tenantSettings.paypal_client_secret ?? '',
    })
  }, [tenantSettings, settingsForm])

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      await client.post('/api/v1/admin/companies', values)
    },
    onSuccess: () => {
      message.success('Tenant creato con successo')
      setCreateOpen(false)
      createForm.resetFields()
      qc.invalidateQueries({ queryKey: ['admin-companies'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? 'Errore creazione tenant'
      message.error(msg)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      await client.put(`/api/v1/admin/companies/${id}`, { is_active })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-companies'] })
    },
    onError: () => message.error('Errore aggiornamento stato'),
  })

  const saveSettingsMutation = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      await client.put(`/api/v1/admin/companies/${settingsCompany!.id}/settings`, values)
    },
    onSuccess: () => {
      message.success('Impostazioni salvate')
      qc.invalidateQueries({ queryKey: ['admin-company-settings', settingsCompany?.id] })
    },
    onError: () => message.error('Errore salvataggio impostazioni'),
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAccedi = async (company: CompanyRow) => {
    try {
      const r = await client.post(`/api/v1/admin/companies/${company.id}/view-token`)
      switchToCompany(r.data.access_token, r.data.company_name, r.data.company_id)
      navigate('/dashboard')
    } catch {
      message.error('Errore accesso azienda')
    }
  }

  const handleNameChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value.trim()
    if (!name) return
    try {
      const r = await client.get('/api/v1/admin/companies/slug-suggestion', { params: { name } })
      createForm.setFieldValue('db_name', r.data.db_name)
    } catch { /* ignore */ }
  }

  const handleCreate = async () => {
    const values = await createForm.validateFields()
    createMutation.mutate(values)
  }

  const handleOpenSettings = (company: CompanyRow) => {
    settingsForm.resetFields()
    setSettingsCompany(company)
  }

  const handleSaveSettings = async () => {
    const values = await settingsForm.validateFields()
    saveSettingsMutation.mutate(values)
  }

  // ── Colonne tabella ────────────────────────────────────────────────────────

  const columns: ColumnType<CompanyRow>[] = [
    {
      title: 'Azienda', dataIndex: 'name', key: 'name',
      render: (v: string) => <b><ShopOutlined style={{ marginRight: 6 }} />{v}</b>,
    },
    {
      title: 'Database', dataIndex: 'db_name', key: 'db_name',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: 'Utenti', dataIndex: 'user_count', key: 'user_count',
      width: 70, align: 'center' as const,
    },
    {
      title: 'Stato', dataIndex: 'is_active', key: 'is_active', width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Attiva' : 'Inattiva'}</Tag>,
    },
    {
      title: 'Azioni', key: 'actions', width: 210,
      render: (_: unknown, c: CompanyRow) => (
        <Space size={4}>
          <Tooltip title="Accedi (sola lettura)">
            <Button
              icon={<EyeOutlined />}
              size="small"
              onClick={() => handleAccedi(c)}
              disabled={!c.is_active}
            >
              Accedi
            </Button>
          </Tooltip>
          <Tooltip title="Impostazioni tenant">
            <Button
              icon={<SettingOutlined />}
              size="small"
              onClick={() => handleOpenSettings(c)}
            />
          </Tooltip>
          <Popconfirm
            title={c.is_active ? 'Disattivare questa azienda?' : 'Riattivare questa azienda?'}
            onConfirm={() => toggleMutation.mutate({ id: c.id, is_active: !c.is_active })}
            okText="Sì"
            cancelText="No"
          >
            <Tooltip title={c.is_active ? 'Disattiva' : 'Attiva'}>
              <Button
                icon={<PoweroffOutlined />}
                size="small"
                danger={c.is_active}
                type={c.is_active ? 'default' : 'primary'}
                loading={toggleMutation.isPending}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900 }}>
      <Space style={{ marginBottom: 24, justifyContent: 'space-between', width: '100%' }}>
        <Title level={3} style={{ margin: 0 }}>Pannello Superadmin</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => { createForm.resetFields(); setCreateOpen(true) }}
        >
          Nuovo Tenant
        </Button>
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

      {/* ── Modal: Nuovo Tenant ─────────────────────────────────────────── */}
      <Modal
        title="Crea Nuovo Tenant"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={createMutation.isPending}
        okText="Crea"
        cancelText="Annulla"
        width={520}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Divider orientation="left" plain>Azienda</Divider>
          <Form.Item
            name="name" label="Nome Azienda"
            rules={[{ required: true, message: 'Inserisci il nome' }]}
          >
            <Input placeholder="es. Vinili del Nord" onChange={handleNameChange} />
          </Form.Item>
          <Form.Item
            name="db_name" label="Nome Database"
            rules={[
              { required: true, message: 'Inserisci il db_name' },
              { pattern: /^[a-z][a-z0-9_]{2,63}$/, message: 'Solo minuscole, cifre, underscore (min 3 chars)' },
            ]}
            extra="Generato automaticamente dal nome, modificabile"
          >
            <Input placeholder="es. posmanager_vinili_nord" />
          </Form.Item>
          <Form.Item
            name="email" label="Email Aziendale"
          >
            <Input placeholder="info@azienda.it" type="email" />
          </Form.Item>

          <Divider orientation="left" plain>Account Admin iniziale</Divider>
          <Form.Item
            name="admin_username" label="Username Admin"
            rules={[{ required: true, message: 'Inserisci lo username' }]}
          >
            <Input placeholder="admin_nomenegozio" />
          </Form.Item>
          <Form.Item
            name="admin_password" label="Password Admin"
            rules={[{ required: true, min: 6, message: 'Minimo 6 caratteri' }]}
          >
            <Input.Password placeholder="Password sicura" />
          </Form.Item>

          <Divider orientation="left" plain>Integrazioni (opzionale)</Divider>
          <Form.Item name="discogs_token" label="Discogs Token">
            <Input.Password placeholder="Token API Discogs" />
          </Form.Item>
          <Form.Item name="discogs_username" label="Discogs Username">
            <Input placeholder="Username Discogs" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Drawer: Impostazioni Tenant ─────────────────────────────────── */}
      <Drawer
        title={`Impostazioni — ${settingsCompany?.name ?? ''}`}
        open={!!settingsCompany}
        onClose={() => setSettingsCompany(null)}
        width={420}
        extra={
          <Button
            type="primary"
            loading={saveSettingsMutation.isPending}
            onClick={handleSaveSettings}
          >
            Salva
          </Button>
        }
      >
        <Form form={settingsForm} layout="vertical">
          <Divider orientation="left" plain>Discogs</Divider>
          <Form.Item name="discogs_token" label="Token API">
            <Input.Password
              placeholder="Token Discogs"
              disabled={settingsFetching}
            />
          </Form.Item>
          <Form.Item name="discogs_username" label="Username">
            <Input placeholder="Username Discogs" disabled={settingsFetching} />
          </Form.Item>
          <Form.Item name="discogs_password" label="Password">
            <Input.Password placeholder="Password Discogs" disabled={settingsFetching} />
          </Form.Item>

          <Divider orientation="left" plain>SumUp</Divider>
          <Form.Item name="sumup_api_key" label="API Key">
            <Input.Password placeholder="SumUp API Key" disabled={settingsFetching} />
          </Form.Item>
          <Form.Item name="sumup_merchant_code" label="Merchant Code">
            <Input placeholder="Merchant Code" disabled={settingsFetching} />
          </Form.Item>

          <Divider orientation="left" plain>PayPal</Divider>
          <Form.Item name="paypal_client_id" label="Client ID">
            <Input placeholder="PayPal Client ID" disabled={settingsFetching} />
          </Form.Item>
          <Form.Item name="paypal_client_secret" label="Client Secret">
            <Input.Password placeholder="PayPal Client Secret" disabled={settingsFetching} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
