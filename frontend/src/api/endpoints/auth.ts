import client from '../client'

export interface LoginResponse {
  access_token: string
  token_type: string
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const params = new URLSearchParams({ username, password })
  const res = await client.post<LoginResponse>('/api/v1/auth/token', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  return res.data
}

export async function getMe() {
  const res = await client.get('/api/v1/auth/me')
  return res.data
}
