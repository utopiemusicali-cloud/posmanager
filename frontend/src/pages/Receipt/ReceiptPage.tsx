import { Alert } from 'antd'

export default function ReceiptPage() {
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>🧾 Nuova Ricevuta</h2>
      <Alert
        type="info"
        message="POS Scanner"
        description="Il modulo di creazione ricevuta con scanner barcode e carrello è in costruzione nella Fase 3."
      />
    </div>
  )
}
