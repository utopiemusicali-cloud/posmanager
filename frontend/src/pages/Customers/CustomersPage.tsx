import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Input, Button, Drawer, Form, Space, Popconfirm, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons'
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from '@/api/endpoints/customers'
import type { Customer } from '@/api/endpoints/customers'

export default function CustomersPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form] = Form.useForm()

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => getCustomers(search || undefined),
  })

  const saveMut = useMutation({
    mutationFn: (vals: Partial<Customer>) =>
      editing ? updateCustomer(editing.id, vals) : createCustomer(vals),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      message.success(editing ? 'Cliente aggiornato' : 'Cliente creato')
      setDrawerOpen(false)
      setEditing(null)
      form.resetFields()
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      message.success('Cliente eliminato')
    },
  })

  const openEdit = (c?: Customer) => {
    setEditing(c ?? null)
    form.setFieldsValue(c ?? {})
    setDrawerOpen(true)
  }

  const columns = [
    { title: 'Nome', dataIndex: 'nome', sorter: (a: Customer, b: Customer) => a.nome.localeCompare(b.nome) },
    { title: 'Telefono', dataIndex: 'tel', width: 130 },
    { title: 'Email', dataIndex: 'mail' },
    { title: 'Instagram', dataIndex: 'instagram', width: 130 },
    { title: 'Note', dataIndex: 'note' },
    {
      title: '',
      width: 80,
      render: (_: unknown, rec: Customer) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(rec)} />
          <Popconfirm title="Eliminare?" onConfirm={() => deleteMut.mutate(rec.id)} okText="Sì" cancelText="No">
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>👥 Rubrica Clienti ({data?.total ?? 0})</h2>
        <Space>
          <Input
            placeholder="Cerca nome, tel, mail..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()}>
            Nuovo Cliente
          </Button>
        </Space>
      </div>

      <Table
        dataSource={data?.items ?? []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 50, showTotal: (t) => `${t} clienti` }}
      />

      <Drawer
        title={editing ? `Modifica: ${editing.nome}` : 'Nuovo Cliente'}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditing(null); form.resetFields() }}
        width={420}
        extra={
          <Button type="primary" onClick={() => form.submit()} loading={saveMut.isPending}>
            Salva
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
          <Form.Item name="nome" label="Nome *" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="tel" label="Telefono">
            <Input />
          </Form.Item>
          <Form.Item name="mail" label="Email">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="instagram" label="Instagram">
            <Input prefix="@" />
          </Form.Item>
          <Form.Item name="note" label="Note">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
