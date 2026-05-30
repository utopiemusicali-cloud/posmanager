import { Tabs } from 'antd'
import CashTab from './tabs/CashTab'
import ExpensesTab from './tabs/ExpensesTab'
import SessionsTab from './tabs/SessionsTab'
import ClosuresTab from './tabs/ClosuresTab'
import ReceiptsTab from './tabs/ReceiptsTab'
import TransactionsTab from './tabs/TransactionsTab'

const items = [
  { key: 'cash', label: '💵 Cassa Contante', children: <CashTab /> },
  { key: 'expenses', label: '💸 Spese', children: <ExpensesTab /> },
  { key: 'receipts', label: '🧾 Ricevute', children: <ReceiptsTab /> },
  { key: 'sessions', label: '📖 Sessioni', children: <SessionsTab /> },
  { key: 'closures', label: '📋 Chiusure', children: <ClosuresTab /> },
  { key: 'sumup', label: '💳 SumUp', children: <TransactionsTab fonte="SumUp" /> },
  { key: 'paypal', label: '🅿️ PayPal', children: <TransactionsTab fonte="PayPal" /> },
]

export default function DashboardPage() {
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <Tabs items={items} size="large" />
    </div>
  )
}
