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

      // NB: in tutti i metodi qui sotto queryClient.clear() va chiamato PRIMA
      // di set(). Invertendo l'ordine, set() fa montare le pagine che lanciano
      // subito le query, e il clear() successivo le cancella mentre sono in
      // volo: nessun re-render le rimette in moto e la pagina resta vuota
      // finche' non si ricarica a mano. Con clear() prima, e' il set() finale
      // a garantire il re-render che popola la cache pulita.

      login: (token, username) => {
        const payload = decodeJwtPayload(token)
        // Dati della sessione precedente (altro utente/azienda) via prima
        // che le pagine della nuova sessione montino.
        queryClient.clear()
        set({ token, username, role: (payload.role as string) ?? null,
              superadminToken: null, viewingCompany: null, viewingCompanyId: null })
      },

      switchToCompany: (viewToken, companyName, companyId) => {
        // Cambio azienda: la cache contiene dati dell'azienda precedente.
        queryClient.clear()
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
        queryClient.clear()
        set({
          token: superadminToken,
          superadminToken: null,
          viewingCompany: null,
          viewingCompanyId: null,
          role: 'superadmin',
        })
      },

      logout: () => {
        queryClient.clear()
        set({
          token: null, username: null, role: null,
          superadminToken: null, viewingCompany: null, viewingCompanyId: null,
        })
      },
    }),
    { name: 'posmanager-auth' },
  ),
)
