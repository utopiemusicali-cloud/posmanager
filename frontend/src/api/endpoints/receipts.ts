import client from '../client'

export interface Receipt {
  id: number
  receipt_ts: string
  numero_ricevuta: string | null
  discount: number
  bonus: number
  total_paid: number
  cliente: string | null
  items: number
  d_items: number
  metodo_pagamento: string | null
  customer_id: number | null
  created_at: string
}

export async function getReceipts(params?: Record<string, unknown>) {
  const res = await client.get('/api/v1/receipts', { params })
  return res.data
}

export async function createReceipt(payload: Partial<Receipt>) {
  const res = await client.post('/api/v1/receipts', payload)
  return res.data
}

export async function getNextReceiptNumber(): Promise<{ numero: number }> {
  const res = await client.get('/api/v1/receipts/next-number')
  return res.data
}
