import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Card, Row, Col, Statistic, Table, Tag, Select, Input, Space, Upload, Button,
  message, Alert, Divider, Tooltip, Typography,
} from 'antd'
import { UploadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import client from '@/api/client'

const { Text } = Typography

interface Movement {
  id: number
  codice_transazione: string
  data: string | null
  tipo: string | null
  riferimento: string | null
  causale: string | null
  stato: string | null
  importo: number
  valuta: string | null
  importo_valuta_originale: number | null
  valuta_originale: string | null
  tasso_cambio: number | null
  commissione: number | null
  saldo_disponibile: number | null
  categoria: string | null
}

const eur = (v: number | null | undefined) =>
  v == null ? '—' : `${Number(v).toFixed(2)} €`

export default function BankTab() {
  const qc = useQueryClient()
  const [days, setDays] = useState(90)
  const [solo, setSolo] = useState<string | undefined>()
  const [tipo, setTipo] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [uploading, setUploading] = useState(false)

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['bank-summary', days],
    queryFn: async () =>
      (await client.get('/api/v1/bank/summary', { params: { days } })).data,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['bank-movements', days, solo, tipo, search, page],
    queryFn: async () =>
      (await client.get('/api/v1/bank/movements', {
        params: { days, solo, tipo, q: search || undefined, page, page_size: 100 },
      })).data,
  })

  const { data: tipiData } = useQuery({
    queryKey: ['bank-types'],
    queryFn: async () => (await client.get('/api/v1/bank/types')).data,
  })

  const { data: categorie } = useQuery({
    queryKey: ['cost-center-categories'],
    queryFn: async () => (await client.get('/api/v1/cost-centers/categories')).data,
    staleTime: 10 * 60_000,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['bank-movements'] })
    qc.invalidateQueries({ queryKey: ['bank-summary'] })
    qc.invalidateQueries({ queryKey: ['bank-types'] })
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await client.post('/api/v1/bank/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const d = res.data
      message.success(
        `${d.nuovi} nuovi movimenti, ${d.aggiornati} aggiornati (${d.letti} letti)`,
      )
      if (d.avvisi?.length) {
        message.warning(d.avvisi.join(' · '), 8)
      }
      refresh()
    } catch (e: any) {
      message.error(e?.response?.data?.detail ?? 'Importazione fallita')
    } finally {
      setUploading(false)
    }
    return false // impedisce l'upload automatico di antd
  }

  const setCategoria = async (id: number, categoria: string | null) => {
    try {
      await client.patch(`/api/v1/bank/movements/${id}`, { categoria: categoria ?? '' })
      refresh()
    } catch {
      message.error('Errore nel salvataggio della categoria')
    }
  }

  const columns = [
    {
      title: 'Data', dataIndex: 'data', width: 100,
      render: (v: string | null) => (v ? dayjs(v).format('DD/MM/YY') : '—'),
    },
    {
      title: 'Descrizione', key: 'desc',
      render: (_: unknown, r: Movement) => (
        <div style={{ lineHeight: 1.35 }}>
          <div>{r.causale || r.riferimento || '—'}</div>
          <div style={{ fontSize: 11, color: '#999' }}>
            {[r.tipo, r.stato].filter(Boolean).join(' · ')}
          </div>
        </div>
      ),
    },
    {
      title: 'Categoria', dataIndex: 'categoria', width: 150,
      render: (v: string | null, r: Movement) => (
        <Select
          size="small"
          variant="borderless"
          placeholder="—"
          value={v || undefined}
          style={{ width: 138 }}
          allowClear
          options={(categorie ?? []).map((c: string) => ({ value: c, label: c }))}
          onChange={(val) => setCategoria(r.id, val ?? null)}
        />
      ),
    },
    {
      title: 'Importo', dataIndex: 'importo', width: 130, align: 'right' as const,
      render: (v: number, r: Movement) => (
        <div style={{ lineHeight: 1.3 }}>
          <b style={{ color: v >= 0 ? '#27ae60' : '#c0392b' }}>
            {v >= 0 ? '+' : ''}{Number(v).toFixed(2)} €
          </b>
          {/* Mostrato solo quando c'e' stato un cambio valuta: altrimenti
              sarebbe una ripetizione dello stesso importo. */}
          {r.valuta_originale && r.valuta_originale !== r.valuta && (
            <div style={{ fontSize: 11, color: '#999' }}>
              {Number(r.importo_valuta_originale ?? 0).toFixed(2)} {r.valuta_originale}
              {r.tasso_cambio ? ` @ ${r.tasso_cambio}` : ''}
            </div>
          )}
          {!!r.commissione && (
            <div style={{ fontSize: 11, color: '#e67e22' }}>
              comm. {Number(r.commissione).toFixed(2)} €
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Saldo', dataIndex: 'saldo_disponibile', width: 110, align: 'right' as const,
      render: (v: number | null) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{eur(v)}</Text>
      ),
    },
  ]

  const uscitePerCategoria = summary?.uscite_per_categoria ?? []

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Upload
          accept=".csv,.txt"
          showUploadList={false}
          beforeUpload={handleUpload}
        >
          <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
            Importa estratto conto
          </Button>
        </Upload>

        <Select
          value={days}
          onChange={(v) => { setDays(v); setPage(1) }}
          style={{ width: 160 }}
          options={[
            { value: 30, label: 'Ultimi 30 giorni' },
            { value: 90, label: 'Ultimi 90 giorni' },
            { value: 365, label: 'Ultimo anno' },
            { value: 3650, label: 'Tutto' },
          ]}
        />
        <Select
          placeholder="Entrate / Uscite"
          value={solo}
          onChange={(v) => { setSolo(v); setPage(1) }}
          style={{ width: 150 }}
          allowClear
          options={[
            { value: 'entrate', label: 'Solo entrate' },
            { value: 'uscite', label: 'Solo uscite' },
          ]}
        />
        <Select
          placeholder="Tipo"
          value={tipo}
          onChange={(v) => { setTipo(v); setPage(1) }}
          style={{ width: 170 }}
          allowClear
          showSearch
          options={(tipiData?.tipi ?? []).map((t: any) => ({
            value: t.value, label: `${t.value} (${t.count})`,
          }))}
        />
        <Input
          placeholder="Cerca causale o riferimento"
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          style={{ width: 240 }}
          allowClear
        />
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title={
                <Tooltip title={summary?.saldo_aggiornato_al
                  ? `Saldo riportato dall'estratto conto al ${dayjs(summary.saldo_aggiornato_al).format('DD/MM/YYYY')}. È il valore dichiarato da SumUp, non un calcolo nostro.`
                  : 'Nessun estratto conto importato'}>
                  Saldo disponibile
                </Tooltip>
              }
              loading={loadingSummary}
              value={summary?.saldo_disponibile ?? 0}
              precision={2}
              suffix="€"
              valueStyle={{ color: '#1677ff' }}
            />
            {summary?.saldo_aggiornato_al && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                al {dayjs(summary.saldo_aggiornato_al).format('DD/MM/YYYY')}
              </Text>
            )}
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Entrate nel periodo" loading={loadingSummary}
                       value={summary?.entrate ?? 0} precision={2} suffix="€"
                       valueStyle={{ color: '#27ae60' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Uscite nel periodo" loading={loadingSummary}
                       value={Math.abs(summary?.uscite ?? 0)} precision={2} suffix="€"
                       valueStyle={{ color: '#c0392b' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Saldo netto del periodo" loading={loadingSummary}
                       value={summary?.saldo_netto_periodo ?? 0} precision={2} suffix="€"
                       valueStyle={{
                         color: (summary?.saldo_netto_periodo ?? 0) >= 0 ? '#27ae60' : '#c0392b',
                       }} />
          </Card>
        </Col>
      </Row>

      {summary?.saldo_disponibile == null && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Nessun estratto conto importato"
          description="SumUp non espone il conto tramite API: scarica l'estratto conto dal loro dashboard e caricalo qui. Reimportare lo stesso file non crea duplicati."
        />
      )}

      {uscitePerCategoria.length > 0 && (
        <>
          <Divider orientation="left" plain>Uscite per categoria</Divider>
          <Space wrap style={{ marginBottom: 16 }}>
            {uscitePerCategoria.map((c: any) => (
              <Tag key={c.categoria} color={c.categoria === 'Non assegnata' ? 'default' : 'blue'}>
                {c.categoria}: <b>{Math.abs(c.totale).toFixed(2)} €</b> ({c.n})
              </Tag>
            ))}
          </Space>
        </>
      )}

      <Table
        dataSource={data?.items ?? []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        size="small"
        pagination={{
          current: page,
          total: data?.total ?? 0,
          pageSize: 100,
          onChange: setPage,
          showTotal: (t) => `${t} movimenti`,
        }}
        locale={{ emptyText: 'Nessun movimento' }}
      />
    </div>
  )
}
