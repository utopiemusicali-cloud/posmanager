import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Card, Form, Input, Select, Button, message, Typography, Divider, Row, Col, Alert,
} from 'antd'
import { SaveOutlined, ApiOutlined } from '@ant-design/icons'
import client from '@/api/client'

const { Title, Text } = Typography

interface ShopSettings {
  id: number
  ragione_sociale: string
  indirizzo: string
  cap: string
  citta: string
  provincia: string
  codice_fiscale: string
  piva: string | null
  numero_rea: string | null
  telefono: string | null
  email: string | null
  regime_fiscale: string
  note_piede: string | null
}

interface Integrations {
  discogs_token: string | null
  discogs_username: string | null
  sumup_api_key: string | null
  sumup_merchant_code: string | null
  paypal_client_id: string | null
  currency: string
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const [form] = Form.useForm()
  const [intForm] = Form.useForm()

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await client.get('/api/v1/settings')
      return res.data as ShopSettings
    },
  })

  const { data: intData, isLoading: intLoading } = useQuery({
    queryKey: ['settings-integrations'],
    queryFn: async () => {
      const res = await client.get('/api/v1/settings/integrations')
      return res.data as Integrations
    },
  })

  useEffect(() => { if (data) form.setFieldsValue(data) }, [data, form])
  useEffect(() => { if (intData) intForm.setFieldsValue(intData) }, [intData, intForm])

  const saveMut = useMutation({
    mutationFn: async (values: Partial<ShopSettings>) => {
      await client.put('/api/v1/settings', values)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      message.success('Impostazioni salvate')
    },
    onError: () => message.error('Errore nel salvataggio'),
  })

  const saveIntMut = useMutation({
    mutationFn: async (values: Partial<Integrations>) => {
      await client.put('/api/v1/settings/integrations', values)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-integrations'] })
      message.success('Integrazioni salvate')
    },
    onError: () => message.error('Errore nel salvataggio'),
  })

  return (
    <div style={{ maxWidth: 720 }}>
      <Title level={4} style={{ marginTop: 0 }}>Impostazioni Negozio</Title>

      <Card loading={isLoading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={saveMut.mutate}
          initialValues={{ regime_fiscale: 'margine' }}
        >
          <Divider orientation="left">Anagrafica</Divider>
          <Form.Item label="Ragione Sociale" name="ragione_sociale" rules={[{ required: true }]}>
            <Input placeholder="Es. Oblique Strategies Records s.r.l." />
          </Form.Item>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item label="Indirizzo" name="indirizzo">
                <Input placeholder="Via Roma, 1" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="CAP" name="cap">
                <Input placeholder="20100" maxLength={5} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={18}>
              <Form.Item label="Città" name="citta">
                <Input placeholder="Milano" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="Prov." name="provincia">
                <Input placeholder="MI" maxLength={2} style={{ textTransform: 'uppercase' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Telefono" name="telefono">
                <Input placeholder="+39 02 1234567" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Email" name="email">
                <Input placeholder="negozio@example.com" />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">Dati Fiscali (AdE)</Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Questi dati sono usati per generare il file corrispettivi da inviare tramite Entratel."
          />
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="Codice Fiscale"
                name="codice_fiscale"
                rules={[{ required: true, message: 'Obbligatorio per export Entratel' }]}
              >
                <Input placeholder="RSSMRA80A01H501Z" style={{ textTransform: 'uppercase' }} maxLength={16} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Partita IVA" name="piva">
                <Input placeholder="12345678901" maxLength={11} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="Numero REA"
                name="numero_rea"
                extra="Registro Imprese Camera di Commercio — es. MI-1234567"
              >
                <Input placeholder="MI-1234567" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Regime Fiscale" name="regime_fiscale" rules={[{ required: true }]}>
                <Select>
                  <Select.Option value="margine">
                    Regime del Margine (D.L. 41/95 art. 36)
                  </Select.Option>
                  <Select.Option value="ordinario">Regime Ordinario IVA</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">Ricevuta</Divider>
          <Form.Item
            label="Nota a piede ricevuta"
            name="note_piede"
            extra='Es. "Regime del margine — art. 36 D.L. 41/95"'
          >
            <Input.TextArea rows={2} placeholder="Testo che appare in fondo alla ricevuta stampata" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saveMut.isPending}
            >
              Salva Impostazioni
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card style={{ marginTop: 16 }} size="small">
        <Text type="secondary" style={{ fontSize: 12 }}>
          <b>Nota AdE:</b> Il file Entratel generato segue il Provvedimento 12/03/2009 prot. 21544/09
          per la trasmissione telematica dei corrispettivi. Il formato è previsto per imprese di Grande
          Distribuzione (art. 1 co. 430 L. 311/2004). Verifica l'applicabilità con il tuo commercialista
          prima dell'invio. Il file va validato tramite il software Entratel o FileInternet dell'AdE.
        </Text>
      </Card>

      {/* ── Integrazioni ─────────────────────────────────────────────────── */}
      <Title level={4} style={{ marginTop: 32 }}>
        <ApiOutlined /> Integrazioni
      </Title>

      <Card loading={intLoading}>
        <Form form={intForm} layout="vertical" onFinish={saveIntMut.mutate}>
          <Divider orientation="left">Discogs</Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <>
                Token personale Discogs — generalo su{' '}
                <b>discogs.com → Impostazioni → Sviluppatori → Token personale</b>
              </>
            }
          />
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item label="Token API Discogs" name="discogs_token">
                <Input.Password placeholder="Il tuo token personale Discogs" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Username Discogs" name="discogs_username">
                <Input placeholder="il_tuo_username" />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">SumUp</Divider>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item label="SumUp API Key" name="sumup_api_key">
                <Input.Password placeholder="sup_sk_..." autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Merchant Code" name="sumup_merchant_code">
                <Input placeholder="MC0XXXXXXX" />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">PayPal</Divider>
          <Form.Item label="PayPal Client ID" name="paypal_client_id">
            <Input placeholder="AXxx..." />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saveIntMut.isPending}
            >
              Salva Integrazioni
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
