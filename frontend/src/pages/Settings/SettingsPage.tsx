import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Card, Form, Input, Select, Button, message, Typography, Divider, Row, Col, Alert,
  Switch, Space, Tag,
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
  sumup_key_set: boolean
  sumup_merchant_code: string | null
  paypal_client_id: string | null
  paypal_sandbox: boolean
  paypal_secret_set: boolean
  ebay_app_id: string | null
  ebay_dev_id: string | null
  ebay_ru_name: string | null
  ebay_sandbox: boolean
  ebay_cert_set: boolean
  ebay_refresh_set: boolean
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

  // Il secret e' legato all'ambiente: quello sandbox non autentica in
  // produzione e viceversa. Se l'utente cambia ambiente deve reinserirlo,
  // altrimenti resterebbe accoppiato un client_id nuovo a un secret vecchio.
  const sandboxNow = Form.useWatch('paypal_sandbox', intForm)
  const envChanged =
    intData != null && sandboxNow !== undefined && sandboxNow !== intData.paypal_sandbox

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

  const testEbayMut = useMutation({
    mutationFn: async () => (await client.post('/api/v1/integrations/ebay/test')).data,
    onSuccess: (d) => {
      message.success(`Credenziali eBay valide (${d.ambiente})`)
      if (!d.autorizzazione_venditore) message.info(d.nota, 8)
    },
    onError: (e: any) =>
      message.error(e?.response?.data?.detail ?? 'Verifica eBay fallita'),
  })

  const ebayConsentMut = useMutation({
    mutationFn: async () =>
      (await client.get('/api/v1/integrations/ebay/consent-url')).data,
    onSuccess: (d) => window.open(d.url, '_blank', 'noopener'),
    onError: (e: any) =>
      message.error(e?.response?.data?.detail ?? 'Impossibile generare il link'),
  })

  const testSumupMut = useMutation({
    mutationFn: async () => (await client.post('/api/v1/integrations/sumup/test')).data,
    onSuccess: (d) =>
      message.success(`Chiave SumUp valida${d.nome ? ` — ${d.nome}` : ''}`),
    onError: (e: any) =>
      message.error(e?.response?.data?.detail ?? 'Verifica SumUp fallita'),
  })

  const syncSumupMut = useMutation({
    mutationFn: async () =>
      (await client.post('/api/v1/integrations/sumup/sync', null, { params: { days: 90 } })).data,
    onSuccess: (d) =>
      message.success(`${d.imported} transazioni SumUp importate (${d.dal} → ${d.al})`),
    onError: (e: any) =>
      message.error(e?.response?.data?.detail ?? 'Importazione SumUp fallita'),
  })

  const testPaypalMut = useMutation({
    mutationFn: async () => (await client.post('/api/v1/integrations/paypal/test')).data,
    onSuccess: (d) => message.success(`Credenziali PayPal valide (${d.ambiente})`),
    onError: (e: any) =>
      message.error(e?.response?.data?.detail ?? 'Verifica PayPal fallita'),
  })

  const syncPaypalMut = useMutation({
    mutationFn: async () =>
      (await client.post('/api/v1/integrations/paypal/sync', null, { params: { days: 90 } })).data,
    onSuccess: (d) =>
      message.success(`${d.imported} transazioni PayPal importate (${d.dal} → ${d.al})`),
    onError: (e: any) =>
      message.error(e?.response?.data?.detail ?? 'Importazione PayPal fallita'),
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

          <Divider orientation="left">eBay</Divider>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="App ID e Cert ID da soli non bastano"
            description="Danno accesso ai soli dati pubblici. Per leggere inventario e ordini eBay richiede l'autorizzazione del venditore tramite consenso nel browser, che produce un refresh token valido circa 18 mesi."
          />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="App ID (Client ID)" name="ebay_app_id">
                <Input placeholder="MyApp-1a2b3c-PRD-..." autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={
                  <Space>
                    <span>Cert ID (Client Secret)</span>
                    {intData?.ebay_cert_set && <Tag color="green">configurato</Tag>}
                  </Space>
                }
                name="ebay_cert_id"
                extra="Non viene mai rimostrato. Lascia vuoto per non modificarlo."
              >
                <Input.Password
                  placeholder={intData?.ebay_cert_set ? '••••••••' : 'PRD-1a2b...'}
                  autoComplete="new-password"
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Dev ID" name="ebay_dev_id">
                <Input placeholder="1a2b3c4d-..." autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="RuName"
                name="ebay_ru_name"
                extra="Nome della URL di ritorno registrata su eBay, serve per il consenso."
              >
                <Input placeholder="Mio_Nome-MyApp-1a2b3-abcdef" autoComplete="off" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label={
              <Space>
                <span>Refresh token venditore</span>
                {intData?.ebay_refresh_set
                  ? <Tag color="green">autorizzazione presente</Tag>
                  : <Tag color="orange">mancante</Tag>}
              </Space>
            }
            name="ebay_refresh_token"
            extra="Si ottiene completando il consenso su eBay. Senza questo, inventario e ordini non sono leggibili."
          >
            <Input.Password
              placeholder={intData?.ebay_refresh_set ? '••••••••' : 'v^1.1#i^1#...'}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item
            label="Ambiente sandbox"
            name="ebay_sandbox"
            valuePropName="checked"
            extra="Cambiando ambiente, Cert ID e refresh token vanno reinseriti: valgono solo per l'ambiente in cui sono stati creati."
          >
            <Switch checkedChildren="Sandbox" unCheckedChildren="Produzione" />
          </Form.Item>
          <Space style={{ marginBottom: 16 }} wrap>
            <Button icon={<ApiOutlined />} onClick={() => testEbayMut.mutate()}
                    loading={testEbayMut.isPending}>
              Verifica credenziali
            </Button>
            <Button onClick={() => ebayConsentMut.mutate()}
                    loading={ebayConsentMut.isPending}>
              Apri consenso venditore
            </Button>
          </Space>

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
        <Form
          form={intForm}
          layout="vertical"
          onFinish={(values) => {
            // Il secret non viene mai rimostrato: un campo lasciato vuoto
            // significa "non toccarlo", non "cancellalo". Senza questo,
            // salvare le altre impostazioni azzererebbe il secret salvato.
            // I segreti non vengono mai rimostrati: un campo lasciato vuoto
            // significa "non toccarlo", non "cancellalo". Senza questo,
            // salvare le altre impostazioni li azzererebbe.
            const {
              paypal_client_secret, sumup_api_key,
              ebay_cert_id, ebay_refresh_token, ...rest
            } = values
            saveIntMut.mutate({
              ...rest,
              ...(paypal_client_secret ? { paypal_client_secret } : {}),
              ...(sumup_api_key ? { sumup_api_key } : {}),
              ...(ebay_cert_id ? { ebay_cert_id } : {}),
              ...(ebay_refresh_token ? { ebay_refresh_token } : {}),
            })
          }}
        >
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
              <Form.Item
                label={
                  <Space>
                    <span>SumUp API Key</span>
                    {intData?.sumup_key_set && <Tag color="green">configurata</Tag>}
                  </Space>
                }
                name="sumup_api_key"
                extra="Non viene mai rimostrata. Lascia vuoto per non modificarla."
              >
                <Input.Password
                  placeholder={intData?.sumup_key_set ? '••••••••' : 'sup_sk_...'}
                  autoComplete="new-password"
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Merchant Code" name="sumup_merchant_code">
                <Input placeholder="MC0XXXXXXX" />
              </Form.Item>
            </Col>
          </Row>

          <Space style={{ marginBottom: 16 }}>
            <Button icon={<ApiOutlined />} onClick={() => testSumupMut.mutate()}
                    loading={testSumupMut.isPending}>
              Verifica connessione
            </Button>
            <Button onClick={() => syncSumupMut.mutate()} loading={syncSumupMut.isPending}>
              Importa transazioni (90 giorni)
            </Button>
          </Space>

          <Divider orientation="left">PayPal</Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="L'importazione richiede che l'app PayPal abbia abilitata la voce
                     «Transaction Search» nel developer dashboard, altrimenti PayPal
                     risponde 403 anche con credenziali corrette."
          />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="PayPal Client ID" name="paypal_client_id">
                <Input placeholder="AXxx..." autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={
                  <Space>
                    <span>PayPal Secret</span>
                    {intData?.paypal_secret_set && !envChanged && <Tag color="green">configurato</Tag>}
                    {envChanged && <Tag color="orange">da reinserire</Tag>}
                  </Space>
                }
                name="paypal_client_secret"
                extra={envChanged
                  ? "Stai cambiando ambiente: il secret memorizzato appartiene all'altro e non funzionerebbe. Reinseriscilo."
                  : "Per motivi di sicurezza non viene mai rimostrato. Lascia vuoto per non modificarlo."}
                rules={envChanged
                  ? [{ required: true, message: 'Cambiando ambiente devi reinserire il secret' }]
                  : []}
                validateStatus={envChanged ? 'warning' : undefined}
              >
                <Input.Password placeholder={intData?.paypal_secret_set ? '••••••••' : 'EDxx...'} autoComplete="new-password" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="Ambiente sandbox"
            name="paypal_sandbox"
            valuePropName="checked"
            extra="Attivo = ambiente di prova PayPal. Disattivalo solo con credenziali di produzione."
          >
            <Switch checkedChildren="Sandbox" unCheckedChildren="Produzione" />
          </Form.Item>
          <Space style={{ marginBottom: 16 }}>
            <Button icon={<ApiOutlined />} onClick={() => testPaypalMut.mutate()}
                    loading={testPaypalMut.isPending}>
              Verifica connessione
            </Button>
            <Button onClick={() => syncPaypalMut.mutate()} loading={syncPaypalMut.isPending}>
              Importa transazioni (90 giorni)
            </Button>
          </Space>

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
