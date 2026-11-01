import type {
  GmItemPriceResult,
  GmItemSearchResult,
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
  VendorShop,
} from '@4story-portal/shared'
import { splitMoney } from '@4story-portal/shared'
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

const number = new Intl.NumberFormat('en-US')

/** A price as the table shows it: `Free`, `0R 5L 0C` or `150 points`. */
export function priceLabel(price: number, shop: VendorShop) {
  if (price === 0) return 'Free'
  if (shop === 'pvp') return `${number.format(price)} points`
  const { rune, luna, cron } = splitMoney(price)
  return `${rune}R ${luna}L ${cron}C`
}

/** A price in a sentence: `75 cron` or `150 points`. */
export const priceText = (price: number, shop: VendorShop) =>
  `${number.format(price)} ${shop === 'pvp' ? 'points' : 'cron'}`

export function useRemoveVendorItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'vendors', 'remove-item'],
    mutationFn: ({ vendorId, itemId }: { vendorId: number; itemId: number }) =>
      apiFetch<void>(`/gm/vendors/${vendorId}/items/${itemId}`, {
        method: 'DELETE',
      }),
    // Also after a failure: "already gone" means the stock is out of date.
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: gmVendorsQueryOptions.queryKey,
      }),
  })
}

export function useSetItemPrice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'vendors', 'set-price'],
    mutationFn: ({ itemId, currency, amount }: { itemId: number; currency: VendorShop; amount: number }) =>
      apiFetch<GmItemPriceResult>(`/gm/items/${itemId}/price`, {
        method: 'PUT',
        body: JSON.stringify({ currency, amount }),
      }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: gmVendorsQueryOptions.queryKey,
      }),
  })
}

export const itemSearchQueryOptions = (q: string) =>
  queryOptions({
    queryKey: ['gm', 'items', q],
    queryFn: () => apiFetch<GmItemSearchResult[]>(`/gm/items?q=${encodeURIComponent(q)}`),
  })

export function useAddVendorItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'vendors', 'add-item'],
    mutationFn: ({ vendorId, itemId }: { vendorId: number; itemId: number }) =>
      apiFetch<GmVendorItem>(`/gm/vendors/${vendorId}/items`, {
        method: 'POST',
        body: JSON.stringify({ itemId }),
      }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: gmVendorsQueryOptions.queryKey,
      }),
  })
}
