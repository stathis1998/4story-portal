import type {
  GmLocation,
  GmLocationInput,
  GmStatus,
  OnlinePlayer,
  TeleportRequest,
  TeleportResult,
} from '@4story-portal/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'

export const gmStatusQueryOptions = queryOptions({
  queryKey: ['gm', 'status'],
  queryFn: () => apiFetch<GmStatus>('/gm/status'),
  refetchInterval: 5000,
})

export const onlinePlayersQueryOptions = queryOptions({
  queryKey: ['gm', 'players'],
  queryFn: () => apiFetch<OnlinePlayer[]>('/gm/players'),
  refetchInterval: 10000,
})

export const gmLocationsQueryOptions = queryOptions({
  queryKey: ['gm', 'locations'],
  queryFn: () => apiFetch<GmLocation[]>('/gm/locations'),
})

export function useTeleport() {
  return useMutation({
    mutationKey: ['gm', 'teleport'],
    mutationFn: (input: TeleportRequest) =>
      apiFetch<TeleportResult>('/gm/teleport', { method: 'POST', body: JSON.stringify(input) }),
  })
}

export function useSaveLocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'locations', 'save'],
    mutationFn: (input: GmLocationInput) =>
      apiFetch<GmLocation>('/gm/locations', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gmLocationsQueryOptions.queryKey }),
  })
}

export function useDeleteLocation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'locations', 'delete'],
    mutationFn: (id: string) => apiFetch<void>(`/gm/locations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: gmLocationsQueryOptions.queryKey }),
  })
}
