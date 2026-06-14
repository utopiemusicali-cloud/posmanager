import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import AppLayout from '@/components/AppLayout'
import LoginPage from '@/pages/Login/LoginPage'
import DashboardPage from '@/pages/Dashboard/DashboardPage'
import ReceiptPage from '@/pages/Receipt/ReceiptPage'
import CustomersPage from '@/pages/Customers/CustomersPage'
import InventoryPage from '@/pages/Inventory/InventoryPage'
import CostCentersPage from '@/pages/CostCenters/CostCentersPage'
import DiscogsOrdersPage from '@/pages/DiscogsOrders/DiscogsOrdersPage'
import SettingsPage from '@/pages/Settings/SettingsPage'
import UsersPage from '@/pages/Users/UsersPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="receipt" element={<ReceiptPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="cost-centers" element={<CostCentersPage />} />
          <Route path="discogs-orders" element={<DiscogsOrdersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="users" element={<UsersPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
