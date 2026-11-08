import type { Character, LevelFreeze } from '@4story-portal/shared'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'

export const charactersQueryOptions = queryOptions({
  queryKey: ['characters'],
  queryFn: () => apiFetch<Character[]>('/characters'),
})

const levelFreezePath = (id: string) => `/characters/${encodeURIComponent(id)}/level-freeze`

export const levelFreezeQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['characters', id, 'level-freeze'],
    queryFn: () => apiFetch<LevelFreeze>(levelFreezePath(id)),
  })

/** A null level removes the freeze. */
export const saveLevelFreeze = (id: string, level: number | null) =>
  apiFetch<LevelFreeze>(levelFreezePath(id), { method: 'PUT', body: JSON.stringify({ level }) })
