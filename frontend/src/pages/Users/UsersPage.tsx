import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table, Button, Tag, Modal, Form, Input, Select, Switch, Space, Typography, Popconfirm, message,
} from 'antd'
import { PlusOutlined, EditOutlined, KeyOutlined } from '@ant-design/icons'
import type { ColumnType } from 'antd/es/table'
import client from '@/api/client'

const { Title } = Typography

interface UserRow {
  id: number
  username: string
  display_name: string | null
  role: string
  is_active: boolean
  company_id: number | null
}

const ROLE_COLORS: Record<string, string> = {
  superadmin: 'gold',
  admin: 'purple',
  operator: 'blue',
  viewer: 'default',
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'operator', label: 'Operator' },
  { value: 'viewer', label: 'Viewer' },
]

async function fetchUsers(): Promise<UserRow[]> {
  const r = await client.get('/api/v1/users')
  return r.data
}

export default function UsersPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [pwdUser, setPwdUser] = useState<UserRow | null>(null)
  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()
  const [pwdForm] = Form.useForm()

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  const createMut = useMutation({
    mutationFn: (v: { username: string; password: string; display_name?: string; role: string }) =>
      client.post('/api/v1/users', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      message.success('Utente creato')
      setCreateOpen(false)
      createForm.resetFields()
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail ?? 'Errore nella creazione')
    },
  })

  const editMut = useMutation({
    mutationFn: (v: { display_name?: string; role?: string; is_active?: boolean }) =>
      client.put(`/api/v1/users/${editUser!.id}`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      message.success('Utente aggiornato')
      setEditUser(null)
    },
    onError: () => message.error('Errore aggiornamento'),
  })

  const pwdMut = useMutation({
    mutationFn: (v: { new_password: string }) =>
      client.post(`/api/v1/users/${pwdUser!.id}/password`, v),
    onSuccess: () => {
      message.success('Password cambiata')
      setPwdUser(null)
      pwdForm.resetFields()
    },
    onError: () => message.error('Errore cambio password'),
  })

  const openEdit = (u: UserRow) => {
    setEditUser(u)
    editForm.setFieldsValue({ display_name: u.display_name, role: u.role, is_active: u.is_active })
  }

  const columns: ColumnType<UserRow>[] = [
    {
      title: 'Username', dataIndex: 'username', key: 'username',
      render: (v: string) => <b>{v}</b>,
    },
    { title: 'Nome', dataIndex: 'display_name', key: 'display_name', render: (v: string | null) => v ?? '—' },
    {
      title: 'Ruolo', dataIndex: 'role', key: 'role',
      render: (v: string) => <Tag color={ROLE_COLORS[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: 'Attivo', dataIndex: 'is_active', key: 'is_active',
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Attivo' : 'Disattivo'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 100, align: 'center' as const,
      render: (_: unknown, u: UserRow) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(u)} />
          <Button size="small" icon={<KeyOutlined />} onClick={() => { setPwdUser(u); pwdForm.resetFields() }} />
        </Space>
      ),
    },
  ]

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>👥 Gestione Utenti</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setCreateOpen(true); createForm.resetFields() }}>
          Nuovo Utente
        </Button>
      </div>

      <Table
        dataSource={users}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={false}
      />

      {/* Modal: crea utente */}
      <Modal
        title="Nuovo Utente"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createMut.isPending}
        okText="Crea"
      >
        <Form form={createForm} layout="vertical" onFinish={createMut.mutate}>
          <Form.Item label="Username" name="username" rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true, min: 6 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="Nome visualizzato" name="display_name">
            <Input />
          </Form.Item>
          <Form.Item label="Ruolo" name="role" initialValue="operator" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: modifica utente */}
      <Modal
        title={`Modifica — ${editUser?.username}`}
        open={!!editUser}
        onCancel={() => setEditUser(null)}
        onOk={() => editForm.submit()}
        confirmLoading={editMut.isPending}
        okText="Salva"
      >
        <Form form={editForm} layout="vertical" onFinish={editMut.mutate}>
          <Form.Item label="Nome visualizzato" name="display_name">
            <Input />
          </Form.Item>
          <Form.Item label="Ruolo" name="role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item label="Attivo" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal: cambia password */}
      <Modal
        title={`Cambia password — ${pwdUser?.username}`}
        open={!!pwdUser}
        onCancel={() => setPwdUser(null)}
        onOk={() => pwdForm.submit()}
        confirmLoading={pwdMut.isPending}
        okText="Cambia"
      >
        <Form form={pwdForm} layout="vertical" onFinish={pwdMut.mutate}>
          <Form.Item label="Nuova password" name="new_password" rules={[{ required: true, min: 6 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="Conferma password"
            name="confirm"
            dependencies={['new_password']}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, v) {
                  return !v || getFieldValue('new_password') === v
                    ? Promise.resolve()
                    : Promise.reject(new Error('Le password non coincidono'))
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
