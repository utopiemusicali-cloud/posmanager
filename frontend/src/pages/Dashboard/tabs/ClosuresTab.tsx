import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table, Tag, Tooltip, Typography, Button, Modal, Form,
  InputNumber, Input, DatePicker, Divider, Spin, Alert,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import client from '@/api/client'

const { Text } = Typography

interface Closure {
  id: number
  closure_ts: string
  tipo: string
  saldo_contabile: number
  effettivo_cassa: number
  differenza: number
  utente: string | null
  note: string | null
  totale_corrispettivi: number | null
  n_ricevute: number | null
  canali_json: string | null
  iva_json: string | null
  numero_rt: string | null
}

interface Preview {
  totale_corrispettivi: number
  n_ricevute: number
  canali: Record<string, number>
}

const EMOJI: Record<string, string> = { Contanti: '💵', SumUp: '💳', PayPal: '🅿️' }

function CanaliTag({ json }: { json: string | null }) {
  if (!json) return <Text type="secondary">—</Text>
  try {
    const canali: Record<string, number> = JSON.parse(json)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {Object.entries(canali).map(([m, v]) => (
          <span key={m} style={{ fontSize: 11 }}>
            {EMOJI[m] ?? '•'} {m}: <b>€ {Number(v).toFixed(2)}</b>
          </span>
        ))}
      </div>
    )
  } catch {
    return <Text type="secondary">err</Text>
  }
}

// ── Modal Nuova Chiusura ─────────────────────────────────────────────────────

function NuovaChiusuraModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form] = Form.useForm()
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs())

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['closure-preview', selectedDate.format('YYYY-MM-DD')],
    queryFn: async () => {
      const res = await client.get('/api/v1/closures/preview', {
        params: { data: selectedDate.startOf('day').toISOString() },
      })
      return res.data as Preview
    },
    enabled: open,
  })

  const saveMut = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      await client.post('/api/v1/closures', values)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['closures'] })
      onClose()
      form.resetFields()
    },
  })

  function handleOk() {
    form.validateFields().then(values => {
      saveMut.mutate({
        closure_ts: (values.closure_ts as Dayjs).toISOString(),
        saldo_contabile: values.saldo_contabile,
        effettivo_cassa: values.effettivo_cassa,
        note: values.note || null,
        numero_rt: values.numero_rt || null,
        tipo: 'Chiusura',
        // corrispettivi vengono auto-calcolati dal server
      })
    })
  }

  // Auto-fill saldo_contabile con totale_corrispettivi quando arriva il preview
  const previewTotal = preview?.totale_corrispettivi
  function fillFromPreview() {
    if (previewTotal != null) {
      form.setFieldValue('saldo_contabile', previewTotal)
    }
  }

  return (
    <Modal
      title="📋 Nuova Chiusura di Cassa"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="Salva chiusura"
      confirmLoading={saveMut.isPending}
      width={520}
    >
      <Form form={form} layout="vertical" initialValues={{ closure_ts: dayjs() }}>

        <Form.Item label="Data e ora chiusura" name="closure_ts" rules={[{ required: true }]}>
          <DatePicker
            showTime
            format="DD/MM/YYYY HH:mm"
            style={{ width: '100%' }}
            onChange={d => { if (d) setSelectedDate(d) }}
          />
        </Form.Item>

        {/* Preview corrispettivi */}
        <Divider>Corrispettivi del giorno (auto-calcolati)</Divider>
        {previewLoading && <Spin size="small" />}
        {preview && (
          <div style={{
            background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6,
            padding: '10px 14px', marginBottom: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text strong style={{ fontSize: 16, color: '#27ae60' }}>
                  € {Number(preview.totale_corrispettivi).toFixed(2)}
                </Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  ({preview.n_ricevute} ricevute)
                </Text>
              </div>
              <Button size="small" onClick={fillFromPreview}>
                → Usa come saldo contabile
              </Button>
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(preview.canali).map(([m, v]) => (
                <span key={m} style={{ fontSize: 12 }}>
                  {EMOJI[m] ?? '•'} {m}: <b>€ {Number(v).toFixed(2)}</b>
                </span>
              ))}
            </div>
          </div>
        )}
        {preview?.n_ricevute === 0 && (
          <Alert message="Nessuna ricevuta trovata per questo giorno." type="info" showIcon style={{ marginBottom: 12 }} />
        )}

        <Form.Item label="Saldo contabile (teorico)" name="saldo_contabile" rules={[{ required: true }]}>
          <InputNumber
            style={{ width: '100%' }} prefix="€" precision={2} min={0}
            placeholder="Totale ricevute - spese contante"
          />
        </Form.Item>

        <Form.Item label="Effettivo in cassa (conteggio fisico)" name="effettivo_cassa" rules={[{ required: true }]}>
          <InputNumber
            style={{ width: '100%' }} prefix="€" precision={2} min={0}
            placeholder="Conteggio fisico cassetto"
          />
        </Form.Item>

        <Form.Item label="Numero RT (BillyScontrino)" name="numero_rt">
          <Input placeholder="es. RT-2024-001" />
        </Form.Item>

        <Form.Item label="Note" name="note">
          <Input.TextArea rows={2} placeholder="Annotazioni..." />
        </Form.Item>

      </Form>
    </Modal>
  )
}

// ── Tabella Chiusure ─────────────────────────────────────────────────────────

export default function ClosuresTab() {
  const [modalOpen, setModalOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['closures'],
    queryFn: async () => {
      const res = await client.get('/api/v1/closures', { params: { limit: 50 } })
      return res.data as Closure[]
    },
  })

  const columns = [
    {
      title: 'Data', dataIndex: 'closure_ts', width: 145,
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Tipo', dataIndex: 'tipo', width: 90,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Corrispettivi', key: 'corr', width: 155,
      render: (_: unknown, r: Closure) => r.totale_corrispettivi != null ? (
        <Tooltip title={`${r.n_ricevute ?? 0} ricevute`}>
          <span style={{ fontWeight: 600, color: '#27ae60' }}>
            € {Number(r.totale_corrispettivi).toFixed(2)}
          </span>
          {r.n_ricevute != null && (
            <Tag style={{ marginLeft: 4 }} color="blue">{r.n_ricevute} ric.</Tag>
          )}
        </Tooltip>
      ) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Canali', key: 'canali', width: 170,
      render: (_: unknown, r: Closure) => <CanaliTag json={r.canali_json} />,
    },
    {
      title: 'Saldo Contabile', dataIndex: 'saldo_contabile', width: 130,
      render: (v: number) => `€ ${Number(v).toFixed(2)}`,
    },
    {
      title: 'Effettivo Cassa', dataIndex: 'effettivo_cassa', width: 130,
      render: (v: number) => `€ ${Number(v).toFixed(2)}`,
    },
    {
      title: 'Diff.', dataIndex: 'differenza', width: 90,
      render: (v: number) => (
        <Tag color={Number(v) === 0 ? 'green' : 'orange'}>{Number(v).toFixed(2)} €</Tag>
      ),
    },
    {
      title: 'RT', dataIndex: 'numero_rt', width: 90,
      render: (v: string | null) => v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">—</Text>,
    },
    { title: 'Utente', dataIndex: 'utente', width: 90 },
    { title: 'Note', dataIndex: 'note', ellipsis: true },
  ]

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Nuova Chiusura
        </Button>
      </div>

      <Table
        dataSource={data ?? []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1100 }}
      />

      <NuovaChiusuraModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
