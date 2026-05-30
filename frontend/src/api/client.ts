import axios from 'axios'
import { useAuthStore } from '@/store/auth'

const client = axios.create({
  // In produzione VITE_API_URL è vuoto → nginx proxia /api
  // In dev è http://localhost:8000
  baseURL: import.meta.env.VITE_API_URL ?? '',
  headers: { 'Content-Type': 'application/json' },
})

// Allega JWT ad ogni richiesta
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Redirect a /login su 401
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default client
