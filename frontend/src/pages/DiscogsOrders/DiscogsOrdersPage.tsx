import { Alert, Button } from 'antd'

export default function DiscogsOrdersPage() {
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>🎵 Ordini Discogs</h2>
      <Alert
        type="info"
        message="Integrazione Discogs"
        description="L'integrazione con l'API Discogs sarà disponibile nella prossima fase. Verrà recuperato lo storico ordini e lo stato delle spedizioni."
        action={<Button disabled>Sincronizza</Button>}
      />
    </div>
  )
}
