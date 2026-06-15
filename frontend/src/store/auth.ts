import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
      },

      switchToCompany: (viewToken, companyName, companyId) => {
        set({
          superadminToken: get().token,
          token: viewToken,
          viewingCompany: companyName,
          viewingCompanyId: companyId,
          role: 'viewer',
        })
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
      },

      logout: () => set({
        token: null, username: null, role: null,
        superadminToken: null, viewingCompany: null, viewingCompanyId: null,
      }),
    }),
    { name: 'posmanager-auth' },
  ),
)
