import type { GmRebirth, RebirthSettingsInput, RebirthState } from '@4story-portal/shared'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'

const rebirthPath = (id: string) => `/characters/${encodeURIComponent(id)}/rebirth`

export const rebirthQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['characters', id, 'rebirth'],
    queryFn: () => apiFetch<RebirthState>(rebirthPath(id)),
  })

/** The price is the one the player was shown; the server refuses it if the price has changed since. */
export const beReborn = (id: string, priceGold: number) =>
  apiFetch<RebirthState>(rebirthPath(id), { method: 'POST', body: JSON.stringify({ priceGold }) })

export const gmRebirthQueryOptions = () =>
  queryOptions({
    queryKey: ['gm', 'rebirth'],
    queryFn: () => apiFetch<GmRebirth>('/gm/rebirth'),
  })

export const saveRebirthSettings = (input: RebirthSettingsInput) =>
  apiFetch<GmRebirth>('/gm/rebirth/settings', { method: 'PUT', body: JSON.stringify(input) })
