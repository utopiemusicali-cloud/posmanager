import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Row, Col, Statistic, Table, Tag, Select, Alert, Tooltip, Space, Divider } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import client from '@/api/client'
import TransactionsTab from './TransactionsTab'
import SumUpReceiptDrawer from './SumUpReceiptDrawer'

interface Payout {
  id: number
  data: string
  tipo: string
  tipo_label: string
  importo: number
  commissione: number
  valuta: string
  stato: string
  riferimento: string
}

const eur = (v: number) => `${Number(v ?? 0).toFixed(2)} €`

export default function SumUpTab() {
  const [days, setDays] = useState(90)
  const [receiptTx, setReceiptTx] = useState<string | null>(null)

  const { data: summary, isLoading: loadingSummary, error: summaryError } = useQuery({
    queryKey: ['sumup-summary', days],
    queryFn: async () =>
      (await client.get('/api/v1/integrations/sumup/summary', { params: { days } })).data,
    retry: false,
  })

  const { data: payoutsData, isLoading: loadingPayouts } = useQuery({
    queryKey: ['sumup-payouts', days],
    queryFn: async () =>
      (await client.get('/api/v1/integrations/sumup/payouts', { params: { days } })).data,
    retry: false,
  })

  const payouts: Payout[] = payoutsData?.payouts ?? []

  const payoutColumns = [
    { title: 'Data', dataIndex: 'data', width: 110,
      render: (v: string) => (v ? dayjs(v).format('DD/MM/YYYY') : '—') },
    { title: 'Tipo', dataIndex: 'tipo_label', width: 170,
      render: (v: string, r: Payout) => (
        <Tag color={r.tipo === 'PAYOUT' ? 'green' : 'orange'}>{v}</Tag>
      ) },
    { title: 'Riferimento', dataIndex: 'riferimento', ellipsis: true },
    { title: 'Commissione', dataIndex: 'commissione', width: 120,
      render: (v: number) => (v ? eur(v) : '—') },
    { title: 'Importo', dataIndex: 'importo', width: 120,
      render: (v: number) => <b>{eur(v)}</b> },
    { title: 'Stato', dataIndex: 'stato', width: 110,
      render: (v: string) => (
        <Tag color={v === 'SUCCESSFUL' ? 'green' : 'red'}>
          {v === 'SUCCESSFUL' ? 'Riuscito' : v}
        </Tag>
      ) },
  ]

  const errMsg = (summaryError as any)?.response?.data?.detail

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <span>Periodo:</span>
        <Select
          value={days}
          onChange={setDays}
          style={{ width: 160 }}
          options={[
            { value: 30, label: 'Ultimi 30 giorni' },
            { value: 90, label: 'Ultimi 90 giorni' },
            { value: 365, label: 'Ultimo anno' },
          ]}
        />
      </Space>

      {errMsg && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={errMsg} />
      )}

      <Row gutter={16} style={{ marginBottom: 8 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Incassato" loading={loadingSummary}
                       value={summary?.incassato ?? 0} precision={2} suffix="€" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title={`Versato (${summary?.n_versamenti ?? 0} bonifici)`}
                       loading={loadingSummary}
                       value={summary?.versato ?? 0} precision={2} suffix="€" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={
                <Tooltip title="SumUp non espone il saldo del conto. Questo valore è una stima calcolata come incassato meno versato nel periodo scelto: un bonifico può liquidare incassi precedenti all'inizio del periodo, quindi allargando la finestra la stima migliora.">
                  <Space size={4}>
                    Non ancora versato (stima)
                    <InfoCircleOutlined style={{ color: '#faad14' }} />
                  </Space>
                </Tooltip>
              }
              loading={loadingSummary}
              value={summary?.non_ancora_versato ?? 0}
              precision={2}
              suffix="€"
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Commissioni sui versamenti" loading={loadingSummary}
                       value={summary?.commissioni_versamenti ?? 0} precision={2} suffix="€" />
          </Card>
        </Col>
      </Row>

      {!!summary?.trattenute && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Nel periodo risultano ${eur(summary.trattenute)} di trattenute (storni, rimborsi o insoluti), già dedotte dai versamenti.`}
        />
      )}

      <Divider orientation="left" plain>Versamenti sul conto</Divider>
      <Table
        dataSource={payouts}
        columns={payoutColumns}
        rowKey="id"
        loading={loadingPayouts}
        size="small"
        pagination={{ pageSize: 10, showTotal: (t) => `${t} versamenti` }}
        locale={{ emptyText: 'Nessun versamento nel periodo' }}
      />

      <Divider orientation="left" plain>Transazioni</Divider>
      <TransactionsTab fonte="SumUp" onReceipt={setReceiptTx} />

      <SumUpReceiptDrawer
        transactionId={receiptTx}
        onClose={() => setReceiptTx(null)}
      />
    </div>
  )
}
