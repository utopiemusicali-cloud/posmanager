import client from '../client'

export interface Customer {
  id: number
  nome: string
  tel: string | null
  mail: string | null
  instagram: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export async function getCustomers(q?: string, page = 1, pageSize = 50) {
  const res = await client.get('/api/v1/customers', { params: { q, page, page_size: pageSize } })
  return res.data
}

export async function createCustomer(payload: Partial<Customer>) {
  const res = await client.post('/api/v1/customers', payload)
  return res.data
}

export async function updateCustomer(id: number, payload: Partial<Customer>) {
  const res = await client.patch(`/api/v1/customers/${id}`, payload)
  return res.data
}

export async function deleteCustomer(id: number) {
  const res = await client.delete(`/api/v1/customers/${id}`)
  return res.data
}
