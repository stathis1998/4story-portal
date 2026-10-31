import type { SessionUser } from '@4story-portal/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createAppQueryClient } from '../lib/query-client'
import { meQueryOptions } from '../lib/session'
import { createAppRouter } from '../router'

/** Renders the real app at `path` with in-memory history and `me` already known. */
export function renderRoute(path: string, { me }: { me: SessionUser | null }) {
  const router = createAppRouter(
    createAppQueryClient(() => {
      queryClient.setQueryData(meQueryOptions.queryKey, null)
      void router.navigate({ to: '/login' })
    }),
    createMemoryHistory({ initialEntries: [path] }),
  )
  // Uses the production query client unchanged, so the tests see the real retry behaviour.
  const { queryClient } = router.options.context
  queryClient.setQueryData(meQueryOptions.queryKey, me)

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { router, queryClient, user: userEvent.setup() }
}
