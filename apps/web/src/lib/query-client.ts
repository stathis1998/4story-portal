import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query'
import { ApiError } from './api'

const isMeQuery = (key: QueryKey | undefined) => key?.[0] === 'me'

/**
 * A 401 from any protected request means the session ended: call onUnauthorized (clear `me`,
 * go to /login). The `me` query itself treats 401 as "signed out" and is excluded.
 */
export function createAppQueryClient(onUnauthorized: () => void): QueryClient {
  const handle = (error: unknown, key?: QueryKey) => {
    if (error instanceof ApiError && error.status === 401 && !isMeQuery(key)) onUnauthorized()
  }

  return new QueryClient({
    defaultOptions: {
      queries: {
        // When the API answered (401, 500, ...) retrying only delays what the user sees; an
        // expired session would otherwise wait out three retries before redirecting. Network
        // failures get one retry.
        retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 1,
      },
    },
    queryCache: new QueryCache({ onError: (error, query) => handle(error, query.queryKey) }),
    mutationCache: new MutationCache({
      // Login answers 401 for bad credentials; that is a form error, not an expired session.
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.options.mutationKey?.[0] !== 'login') handle(error)
      },
    }),
  })
}
