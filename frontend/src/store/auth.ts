import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { queryClient } from '@/lib/queryClient'

interface AuthState {
  token: string | null
  username: string | null
  role: string | null
  // Superadmin: switch company view
  superadminToken: string | null
  viewingCompany: string | null
  viewingCompanyId: number | null
  login: (token: string, username: string) => void
  switchToCompany: (viewToken: string, companyName: string, companyId: number) => void
  exitCompanyView: () => void
  logout: () => void
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split('.')
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return {}
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      username: null,
      role: null,
      superadminToken: null,
      viewingCompany: null,
      viewingCompanyId: null,

      login: (token, username) => {
        const payload = decodeJwtPayload(token)
        set({ token, username, role: (payload.role as string) ?? null,
              superadminToken: null, viewingCompany: null, viewingCompanyId: null })
        // Svuota la cache: dati della sessione precedente (altro utente/azienda)
        // non devono restare visibili dopo il login.
        queryClient.clear()
      },

      switchToCompany: (viewToken, companyName, companyId) => {
        set({
          superadminToken: get().token,
          token: viewToken,
          viewingCompany: companyName,
          viewingCompanyId: companyId,
          role: 'viewer',
        })
        // Cambio azienda: la cache contiene dati dell'azienda precedente.
        queryClient.clear()
      },

      exitCompanyView: () => {
        const { superadminToken } = get()
        set({
          token: superadminToken,
          superadminToken: null,
          viewingCompany: null,
          viewingCompanyId: null,
          role: 'superadmin',
        })
        queryClient.clear()
      },

      logout: () => {
        set({
          token: null, username: null, role: null,
          superadminToken: null, viewingCompany: null, viewingCompanyId: null,
        })
        queryClient.clear()
      },
    }),
    { name: 'posmanager-auth' },
  ),
)
