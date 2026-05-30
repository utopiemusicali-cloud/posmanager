import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ConfigProvider, theme } from 'antd'
import itIT from 'antd/locale/it_IT'
import dayjs from 'dayjs'
import 'dayjs/locale/it'
import App from './App'

dayjs.locale('it')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={itIT}
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#8e44ad',
            borderRadius: 6,
          },
        }}
      >
        <App />
      </ConfigProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
)
