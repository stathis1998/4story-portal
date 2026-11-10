import type { OnlineCharacter } from '@4story-portal/shared'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'

export const ONLINE_REFRESH_MS = 30_000

export const onlineQueryOptions = queryOptions({
  queryKey: ['online'],
  queryFn: () => apiFetch<OnlineCharacter[]>('/online'),
  refetchInterval: ONLINE_REFRESH_MS,
})
