import client from '../client'

export interface CashMovement {
  id: number
  movement_ts: string
  importo: number
  utente: string | null
  nota: string | null
  fornitore: string | null
  tipo_spesa: string | null
  metodo_pagamento: string | null
  ricevuta: string | null
  numero_ricevuta: string | null
  saldo: number | null
  created_at: string
  updated_at: string
}

export interface CreateMovimentoPayload {
  movement_ts: string
  importo: number
  utente?: string
  nota?: string
  fornitore?: string
  tipo_spesa?: string
  metodo_pagamento?: string
}

export async function getMovimenti(params?: Record<string, unknown>) {
  const res = await client.get('/api/v1/cassa/movimenti', { params })
  return res.data
}

export async function createMovimento(payload: CreateMovimentoPayload) {
  const res = await client.post('/api/v1/cassa/movimenti', payload)
  return res.data
}

export async function deleteMovimento(id: number) {
  const res = await client.delete(`/api/v1/cassa/movimenti/${id}`)
  return res.data
}

export async function getSaldo() {
  const res = await client.get('/api/v1/cassa/saldo')
  return res.data
}
