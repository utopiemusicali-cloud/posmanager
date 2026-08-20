import { useQuery } from '@tanstack/react-query'
import { Drawer, Timeline, Tag, Empty, Spin, Typography } from 'antd'
import client from '@/api/client'

const { Text } = Typography

export interface HistoryEvent {
  id: number
  listing_id: string
  event_type: string
  field: string
  field_label: string
  old_value: string
  new_value: string
  source: string
  username: string
  note: string
  created_at: string | null
}

const EVENT_COLORS: Record<string, string> = {
  created: 'green',
  updated: 'blue',
  sold: 'gold',
  deleted: 'red',
  discogs_push: 'purple',
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Creato',
  updated: 'Modifica',
  sold: 'Venduto',
  deleted: 'Rimosso',
  discogs_push: 'Push Discogs',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function Author({ e }: { e: HistoryEvent }) {
  if (e.source === 'discogs_sync') return <Tag color="cyan">Sync Discogs</Tag>
  if (e.username) return <Text type="secondary" style={{ fontSize: 12 }}>{e.username}</Text>
  return <Text type="secondary" style={{ fontSize: 12 }}>sistema</Text>
}

function EventBody({ e }: { e: HistoryEvent }) {
  return (
    <div style={{ lineHeight: 1.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Tag color={EVENT_COLORS[e.event_type] ?? 'default'}>
          {EVENT_LABELS[e.event_type] ?? e.event_type}
        </Tag>
        {e.field && <Text strong style={{ fontSize: 13 }}>{e.field_label}</Text>}
        <Author e={e} />
      </div>

      {e.field && (
        <div style={{ fontSize: 13, marginTop: 2 }}>
          <Text delete type="secondary">{e.old_value || '(vuoto)'}</Text>
          <Text type="secondary"> → </Text>
          <Text strong>{e.new_value || '(vuoto)'}</Text>
        </div>
      )}

      {e.note && (
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{e.note}</div>
      )}

      <div style={{ fontSize: 11, color: '#aaa' }}>{formatDateTime(e.created_at)}</div>
    </div>
  )
}

export default function HistoryDrawer({ listingId, title, onClose }: {
  listingId: string | null
  title?: string
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-history', listingId],
    queryFn: async () =>
      (await client.get(`/api/v1/inventory/items/${encodeURIComponent(listingId!)}/history`)).data,
    enabled: !!listingId,
  })

  const events: HistoryEvent[] = data?.events ?? []

  return (
    <Drawer
      open={!!listingId}
      onClose={onClose}
      width={460}
      title={<span>🕘 Storico {title ? `— ${title}` : ''}</span>}
    >
      {isLoading && <Spin />}

      {!isLoading && events.length === 0 && (
        <Empty description="Nessuna modifica registrata per questo articolo" />
      )}

      {!isLoading && events.length > 0 && (
        <Timeline
          items={events.map(e => ({
            color: EVENT_COLORS[e.event_type] ?? 'gray',
            children: <EventBody e={e} />,
          }))}
        />
      )}
    </Drawer>
  )
}
