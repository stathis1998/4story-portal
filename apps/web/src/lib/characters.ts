import type { Character } from '@4story-portal/shared'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'

export const charactersQueryOptions = queryOptions({
  queryKey: ['characters'],
  queryFn: () => apiFetch<Character[]>('/characters'),
})
