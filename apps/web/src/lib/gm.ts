import type {
  GmLocation,
  GmLocationInput,
  GmLogin,
  GmLoginClearResult,
  GmMap,
  GmPlaces,
  GmStatus,
  GmVendor,
  GmVendorItem,
  GmVendorList,
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

// Chart data: it only changes when the import is rerun and the API restarted.
export const gmPlacesQueryOptions = queryOptions({
  queryKey: ['gm', 'places'],
  queryFn: () => apiFetch<GmPlaces>('/gm/places'),
  staleTime: Infinity,
})

/** A map's name, or "Map 600" for the maps the client has no name for. */
export const mapName = (id: number, name: string | null | undefined) => name ?? `Map ${id}`

export const mapOptionLabel = ({ id, name }: GmMap) => (name ? `${id} – ${name}` : mapName(id, name))

export const gmLoginsQueryOptions = queryOptions({
  queryKey: ['gm', 'logins'],
  queryFn: () => apiFetch<GmLogin[]>('/gm/logins'),
  refetchInterval: 10000,
})

export function useClearLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'logins', 'clear'],
    mutationFn: (key: number) => apiFetch<GmLoginClearResult>(`/gm/logins/${key}/clear`, { method: 'POST' }),
    // Also after a failure: "already gone" means the list is out of date.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: gmLoginsQueryOptions.queryKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: onlinePlayersQueryOptions.queryKey }),
      ]),
  })
}

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

export const gmVendorsQueryOptions = queryOptions({
  queryKey: ['gm', 'vendors'],
  queryFn: () => apiFetch<GmVendorList>('/gm/vendors'),
})

export const vendorStockQueryOptions = (id: number) =>
  queryOptions({
    queryKey: ['gm', 'vendors', id, 'items'],
    queryFn: () => apiFetch<GmVendorItem[]>(`/gm/vendors/${id}/items`),
  })

/** The vendor's name, else its title, else "NPC 20002". The API already turns the database's '_' into ''. */
export const vendorDisplayName = (vendor: GmVendor) => vendor.name || vendor.title || `NPC ${vendor.id}`
