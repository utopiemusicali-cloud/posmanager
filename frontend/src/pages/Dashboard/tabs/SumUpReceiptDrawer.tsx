import { useQuery } from '@tanstack/react-query'
import { Drawer, Descriptions, Table, Tag, Spin, Alert, Divider, Typography, Space } from 'antd'
import dayjs from 'dayjs'
import client from '@/api/client'

const { Text } = Typography

const eur = (v: number | null | undefined) =>
  v == null ? '—' : `${Number(v).toFixed(2)} €`

// Percentuale: SumUp esprime l'aliquota come frazione (0.22), non come 22.
const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${(Number(v) * 100).toFixed(0)}%`

const EVENT_LABELS: Record<string, string> = {
  PAYOUT: 'Versamento',
  CHARGE_BACK: 'Storno',
  REFUND: 'Rimborso',
  PAYOUT_DEDUCTION: 'Trattenuta',
}

const EVENT_STATUS: Record<string, { label: string; color: string }> = {
  PAID_OUT: { label: 'Versato', color: 'green' },
  SUCCESSFUL: { label: 'Riuscito', color: 'green' },
  RECONCILED: { label: 'Riconciliato', color: 'green' },
  PENDING: { label: 'In corso', color: 'orange' },
  SCHEDULED: { label: 'Programmato', color: 'blue' },
  REFUNDED: { label: 'Rimborsato', color: 'purple' },
  FAILED: { label: 'Fallito', color: 'red' },
}

export default function SumUpReceiptDrawer({ transactionId, onClose }: {
  transactionId: string | null
  onClose: () => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sumup-receipt', transactionId],
    queryFn: async () =>
      (await client.get(
        `/api/v1/integrations/sumup/receipt/${encodeURIComponent(transactionId!)}`,
      )).data,
    enabled: !!transactionId,
    retry: false,
  })

  const errMsg = (error as any)?.response?.data?.detail

  return (
    <Drawer
      open={!!transactionId}
      onClose={onClose}
      width={620}
      title={
        <Space>
          <span>🧾 Ricevuta SumUp</span>
          {data?.numero_ricevuta && <Tag>n. {data.numero_ricevuta}</Tag>}
        </Space>
      }
    >
      {isLoading && <Spin />}

      {errMsg && <Alert type="error" showIcon message={errMsg} />}

      {data && !errMsg && (
        <>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="Data" span={2}>
              {data.data ? dayjs(data.data).format('DD/MM/YYYY HH:mm') : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Totale">
              <b>{eur(data.importo)}</b>
            </Descriptions.Item>
            <Descriptions.Item label="di cui IVA">{eur(data.iva_totale)}</Descriptions.Item>
            {!!data.mancia && (
              <Descriptions.Item label="Mancia" span={2}>{eur(data.mancia)}</Descriptions.Item>
            )}
            <Descriptions.Item label="Carta">
              {data.carta_tipo || '—'}
              {data.carta_ultime4 ? ` ••••${data.carta_ultime4}` : ''}
            </Descriptions.Item>
            <Descriptions.Item label="Modalità">
              {data.modalita_inserimento || '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Codice transazione">
              <Text copyable style={{ fontSize: 12 }}>{data.transaction_code || '—'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Autorizzazione">
              {data.codice_autorizzazione || '—'}
            </Descriptions.Item>
          </Descriptions>

          {data.prodotti?.length > 0 && (
            <>
              <Divider orientation="left" plain>Righe</Divider>
              <Table
                dataSource={data.prodotti}
                rowKey={(_, i) => String(i)}
                size="small"
                pagination={false}
                columns={[
                  { title: 'Articolo', dataIndex: 'nome',
                    render: (v: string, r: any) => (
                      <div>
                        <div>{v || '—'}</div>
                        {r.descrizione && (
                          <div style={{ fontSize: 11, color: '#999' }}>{r.descrizione}</div>
                        )}
                      </div>
                    ) },
                  { title: 'Qtà', dataIndex: 'quantita', width: 60, align: 'right' as const },
                  { title: 'Aliquota', dataIndex: 'aliquota', width: 80, align: 'right' as const,
                    render: pct },
                  { title: 'Totale', dataIndex: 'totale', width: 90, align: 'right' as const,
                    render: eur },
                ]}
              />
            </>
          )}

          {data.iva_per_aliquota?.length > 0 && (
            <>
              <Divider orientation="left" plain>Ripartizione IVA</Divider>
              <Table
                dataSource={data.iva_per_aliquota}
                rowKey={(_, i) => String(i)}
                size="small"
                pagination={false}
                columns={[
                  { title: 'Aliquota', dataIndex: 'aliquota', render: pct },
                  { title: 'Imponibile', dataIndex: 'imponibile', align: 'right' as const, render: eur },
                  { title: 'IVA', dataIndex: 'iva', align: 'right' as const, render: eur },
                  { title: 'Lordo', dataIndex: 'lordo', align: 'right' as const, render: eur },
                ]}
              />
            </>
          )}

          {data.eventi?.length > 0 && (
            <>
              <Divider orientation="left" plain>
                Stato dell&apos;incasso
              </Divider>
              <Table
                dataSource={data.eventi}
                rowKey={(_, i) => String(i)}
                size="small"
                pagination={false}
                columns={[
                  { title: 'Evento', dataIndex: 'tipo', width: 130,
                    render: (v: string) => EVENT_LABELS[v] ?? v },
                  { title: 'Stato', dataIndex: 'stato', width: 130,
                    render: (v: string) => {
                      const s = EVENT_STATUS[v]
                      return <Tag color={s?.color ?? 'default'}>{s?.label ?? v}</Tag>
                    } },
                  { title: 'Importo', dataIndex: 'importo', align: 'right' as const, render: eur },
                  { title: 'Data', dataIndex: 'data', width: 110,
                    render: (v: string) => (v ? dayjs(v).format('DD/MM/YY') : '—') },
                ]}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Qui si vede se questo singolo incasso è già stato versato sul conto.
              </Text>
            </>
          )}

          {data.esercente && (
            <>
              <Divider orientation="left" plain>Esercente</Divider>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {data.esercente}
                {data.partita_iva ? ` · P.IVA ${data.partita_iva}` : ''}
              </Text>
            </>
          )}
        </>
      )}
    </Drawer>
  )
}
