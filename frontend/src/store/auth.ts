import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  username: string | null
  role: string | null
  login: (token: string, username: string) => void
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
    (set) => ({
      token: null,
      username: null,
      role: null,
      login: (token, username) => {
        const payload = decodeJwtPayload(token)
        set({ token, username, role: (payload.role as string) ?? null })
      },
      logout: () => set({ token: null, username: null, role: null }),
    }),
    { name: 'posmanager-auth' },
  ),
)
