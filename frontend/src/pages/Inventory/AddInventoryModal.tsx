import { useEffect, useState } from 'react'
import {
  Modal, Form, Input, Select, Radio, Button, InputNumber,
  Space, Spin, Alert, Divider, message,
} from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import client from '@/api/client'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

interface DropdownOptions {
  media_conditions: string[]
  sleeve_conditions: string[]
  locations: string[]
  statuses: string[]
}

interface DiscogsRelease {
  release_id: number
  artist: string
  title: string
  label: string
  catno: string
  format: string
  format_quantity: number
  weight: number
  country: string
  year: string
  genere: string
  stile: string
}

export default function AddInventoryModal({ open, onClose, onSuccess }: Props) {
  const [form] = Form.useForm()
  const [mode, setMode] = useState<'nod_unoff' | 'inv_os'>('nod_unoff')
  const [options, setOptions] = useState<DropdownOptions | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [release, setRelease] = useState<DiscogsRelease | null>(null)
  const [saving, setSaving] = useState(false)

  // Carica il prossimo listing_id e le opzioni dropdown all'apertura
  useEffect(() => {
    if (!open) return
    Promise.all([
      client.get('/api/v1/inventory/dropdown-options'),
      client.get(`/api/v1/inventory/next-listing-id?mode=${mode}`),
    ]).then(([opts, nid]) => {
      setOptions(opts.data)
      form.setFieldValue('listing_id', nid.data.next_id)
    })
  }, [open, mode, form])

  const handleModeChange = async (newMode: 'nod_unoff' | 'inv_os') => {
    setMode(newMode)
    setRelease(null)
    form.resetFields(['url_discogs', 'price', 'comments', 'external_id', 'weight',
      'artist', 'title', 'label', 'catno', 'format', 'costo_unitario'])
    const res = await client.get(`/api/v1/inventory/next-listing-id?mode=${newMode}`)
    form.setFieldValue('listing_id', res.data.next_id)
    form.setFieldValue('media_condition', mode === 'nod_unoff' ? 'Very Good (VG)' : 'Mint (M)')
    form.setFieldValue('sleeve_condition', mode === 'nod_unoff' ? 'Good Plus (G+)' : 'Mint (M)')
  }

  const handleLookup = async () => {
    const url = form.getFieldValue('url_discogs')?.trim()
    if (!url) { message.warning('Inserisci prima un URL Discogs'); return }
    setLookingUp(true)
    try {
      const res = await client.get('/api/v1/inventory/lookup-url', { params: { url } })
      const r: DiscogsRelease = res.data
      setRelease(r)
      form.setFieldsValue({ weight: r.weight })
      message.success(`Trovato: ${r.artist} – ${r.title}`)
    } catch {
      message.error('URL non valido o errore Discogs API')
    } finally {
      setLookingUp(false)
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      const payload: Record<string, unknown> = {
        mode,
        listing_id: values.listing_id,
        status: values.status ?? 'For Sale',
        price: values.price,
        location: values.location,
        media_condition: values.media_condition,
        sleeve_condition: values.sleeve_condition,
        comments: values.comments ?? '',
        external_id: values.external_id ?? '',
        weight: values.weight ?? null,
        accept_offer: 'N',
      }

      if (mode === 'nod_unoff') {
        if (!release) { message.warning('Cerca prima l\'URL Discogs'); setSaving(false); return }
        Object.assign(payload, {
          url_discogs: values.url_discogs,
          release_id: release.release_id,
          artist: release.artist,
          title: release.title,
          label: release.label,
          catno: release.catno,
          format: release.format,
          format_quantity: release.format_quantity,
          country: release.country,
          year: release.year,
          genere: release.genere,
          stile: release.stile,
        })
      } else {
        Object.assign(payload, {
          artist: values.artist ?? '',
          title: values.title ?? '',
          label: values.label ?? '',
          catno: values.catno ?? '',
          format: values.format ?? '',
          release_id: values.release_id ?? null,
          costo_unitario: values.costo_unitario ?? null,
        })
      }

      await client.post('/api/v1/inventory/items', payload)
      message.success(`Listing ${values.listing_id} aggiunto`)
      form.resetFields()
      setRelease(null)
      onSuccess()
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'response' in e) {
        const err = e as { response: { data: { detail: string } } }
        message.error(err.response?.data?.detail ?? 'Errore durante il salvataggio')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    form.resetFields()
    setRelease(null)
    setMode('nod_unoff')
    onClose()
  }

  return (
    <Modal
      title="➕ Aggiungi Inventario"
      open={open}
      onCancel={handleClose}
      width={640}
      footer={[
        <Button key="cancel" onClick={handleClose}>Annulla</Button>,
        <Button key="save" type="primary" loading={saving} onClick={handleSave}>
          Salva
        </Button>,
      ]}
    >
      {/* Selezione modalità */}
      <Radio.Group
        value={mode}
        onChange={(e) => handleModeChange(e.target.value)}
        style={{ marginBottom: 16 }}
        buttonStyle="solid"
      >
        <Radio.Button value="nod_unoff">NOD-UNOFF (Discogs)</Radio.Button>
        <Radio.Button value="inv_os">INVENTARIO OS (manuale)</Radio.Button>
      </Radio.Group>

      <Form form={form} layout="vertical" size="small"
        initialValues={{ status: 'For Sale', location: 'UNOFF',
          media_condition: 'Very Good (VG)', sleeve_condition: 'Good Plus (G+)' }}>

        {/* Listing ID (read-only, auto-generato) */}
        <Form.Item label="Listing ID" name="listing_id">
          <Input readOnly style={{ background: '#f5f5f5' }} />
        </Form.Item>

        {/* ── NOD-UNOFF: URL Discogs ── */}
        {mode === 'nod_unoff' && (
          <>
            <Form.Item label="URL Discogs" name="url_discogs"
              rules={[{ required: true, message: 'URL obbligatorio' }]}>
              <Space.Compact style={{ width: '100%' }}>
                <Input placeholder="https://www.discogs.com/release/..." />
                <Button icon={<SearchOutlined />} onClick={handleLookup} loading={lookingUp}>
                  Cerca
                </Button>
              </Space.Compact>
            </Form.Item>

            {release && (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 12 }}
                message={<><b>{release.artist}</b> – {release.title}</>}
                description={`${release.label} · ${release.catno} · ${release.format} · ${release.year}`}
              />
            )}
          </>
        )}

        {/* ── INVENTARIO OS: campi manuali ── */}
        {mode === 'inv_os' && (
          <>
            <Divider orientation="left" plain style={{ margin: '8px 0' }}>Dati articolo</Divider>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
              <Form.Item label="Artista" name="artist" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item label="Titolo" name="title" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item label="Label" name="label"><Input /></Form.Item>
              <Form.Item label="Cat#" name="catno"><Input /></Form.Item>
              <Form.Item label="Formato" name="format"><Input /></Form.Item>
              <Form.Item label="Release ID" name="release_id"><InputNumber style={{ width: '100%' }} /></Form.Item>
              <Form.Item label="Costo Unitario (€)" name="costo_unitario">
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
              </Form.Item>
            </div>
          </>
        )}

        <Divider orientation="left" plain style={{ margin: '8px 0' }}>Prezzi e condizioni</Divider>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
          <Form.Item label="Prezzo (€)" name="price" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.5} />
          </Form.Item>
          <Form.Item label="Location" name="location">
            <Select options={(options?.locations ?? _LOCATIONS).map(v => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item label="Media Condition" name="media_condition">
            <Select options={(options?.media_conditions ?? []).map(v => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item label="Sleeve Condition" name="sleeve_condition">
            <Select options={(options?.sleeve_conditions ?? []).map(v => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item label="Weight (g)" name="weight">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="External ID" name="external_id"><Input /></Form.Item>
        </div>

        <Form.Item label="Comments" name="comments">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

const _LOCATIONS = ['UNOFF', 'OS Records', 'Deposito']
