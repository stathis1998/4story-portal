import type {
  GmEvent,
  GmEventInput,
  GmEventList,
  GmEventSchedule,
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
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'

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

export const gmEventsQueryOptions = queryOptions({
  queryKey: ['gm', 'events'],
  queryFn: () => apiFetch<GmEventList>('/gm/events'),
  // Events start and stop on their own schedule.
  refetchInterval: 5000,
})

const invalidateEvents = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: gmEventsQueryOptions.queryKey, exact: true })

export function useCreateEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GmEventInput) =>
      apiFetch<GmEvent>('/gm/events', { method: 'POST', body: JSON.stringify(input) }),
    onSettled: () => invalidateEvents(queryClient),
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ index, input }: { index: number; input: GmEventInput }) =>
      apiFetch<GmEvent>(`/gm/events/${index}`, { method: 'PUT', body: JSON.stringify(input) }),
    // Also after a failure: "already ended" means the list is out of date.
    onSettled: () => invalidateEvents(queryClient),
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (index: number) => apiFetch<void>(`/gm/events/${index}`, { method: 'DELETE' }),
    onSettled: () => invalidateEvents(queryClient),
  })
}

/** The API writes its event errors for the GM, including the 502s and 503s. */
export function eventErrorMessage(err: unknown) {
  return err instanceof ApiError && (err.status < 500 || err.status === 502 || err.status === 503)
    ? err.message
    : 'Something went wrong. Please try again.'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Split by hand rather than through Date: these are the server's clock, not the browser's.
function wallClockParts(value: string) {
  const [, month, day] = value.slice(0, 10).split('-').map(Number)
  return { day, month: MONTHS[month - 1], date: `${day} ${MONTHS[month - 1]}`, time: value.slice(11) }
}

export function formatEventSchedule({ mode, start, end }: GmEventSchedule) {
  const from = wallClockParts(start)
  const to = wallClockParts(end)
  if (mode === 'period') return `${from.date} ${from.time} → ${to.date} ${to.time}`

  const window = `Daily ${from.time}–${to.time}`
  if (start.slice(0, 10) === end.slice(0, 10)) return `${window}, ${from.date}`
  if (from.month === to.month) return `${window}, ${from.day}–${to.date}`
  return `${window}, ${from.date} – ${to.date}`
}

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

/** The item's name, else "Item #8001" (the database held '_'). A null name is not in TITEMCHART: "Unknown item #8001". */
export const itemDisplayName = ({ itemId, name }: { itemId: number; name: string | null }) =>
  name === null ? `Unknown item #${itemId}` : name || `Item #${itemId}`

/** "1 vendor" or "12 vendors". */
export const vendorCount = (count: number) => `${count} ${count === 1 ? 'vendor' : 'vendors'}`

const number = new Intl.NumberFormat('en-US')

/** A price in words, for notes: `1 Rune 2 Luna 3 Cron`, `75 Cron` or `150 points`. */
export function priceText(price: number, shop: VendorShop) {
  if (shop === 'pvp') return `${number.format(price)} points`
  const { rune, luna, cron } = splitMoney(price)
  return [
    [rune, 'Rune'],
    [luna, 'Luna'],
    [cron, 'Cron'],
  ]
    .filter(([amount]) => amount !== 0)
    .map(([amount, name]) => `${number.format(amount as number)} ${name}`)
    .join(' ')
}

/** The note shown after a price is saved. */
export function priceNote(name: string, { price, soldBy }: GmItemPriceResult, shop: VendorShop) {
  return price === 0
    ? `${name} is now free at ${vendorCount(soldBy)}. Restart TMapSvr to apply.`
    : `${name} now costs ${priceText(price, shop)} at ${vendorCount(soldBy)}. Restart TMapSvr to apply.`
}

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
    // Search results carry prices too, and a lowered price can make an item addable.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: gmVendorsQueryOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: ['gm', 'items'] }),
      ]),
  })
}

export const itemSearchQueryOptions = (q: string, shop: VendorShop) =>
  queryOptions({
    queryKey: ['gm', 'items', q, shop],
    queryFn: () => apiFetch<GmItemSearchResult[]>(`/gm/items?q=${encodeURIComponent(q)}&shop=${shop}`),
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
