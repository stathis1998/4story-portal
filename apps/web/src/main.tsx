import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { createAppQueryClient } from './lib/query-client'
import { meQueryOptions } from './lib/session'
import { createAppRouter } from './router'

// An expired session anywhere sends the user back to /login.
const queryClient = createAppQueryClient(() => {
  queryClient.setQueryData(meQueryOptions.queryKey, null)
  void router.navigate({ to: '/login' })
})
const router = createAppRouter(queryClient)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
