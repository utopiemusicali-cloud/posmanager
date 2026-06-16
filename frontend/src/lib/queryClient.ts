import { QueryClient } from '@tanstack/react-query'

// Istanza condivisa: deve essere importabile anche fuori da React (es. dallo
// store di autenticazione) per poter svuotare la cache quando cambia il
// contesto azienda/utente (login, switch tenant, logout). Senza questo,
// dati di un'azienda potrebbero restare visibili dopo il cambio di tenant.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})
