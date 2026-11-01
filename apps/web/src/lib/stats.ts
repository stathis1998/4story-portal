import type { ActiveEvents, CharacterProfile, HallOfFame, HallOfFameSettings, PlayerOverview } from '@4story-portal/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'

export const overviewQueryOptions = queryOptions({
  // Not under 'me': the query client treats that key as the login check and ignores its 401s.
  queryKey: ['overview'],
  queryFn: () => apiFetch<PlayerOverview>('/me/overview'),
})

export const activeEventsQueryOptions = queryOptions({
  queryKey: ['events', 'active'],
  queryFn: () => apiFetch<ActiveEvents>('/events/active'),
  refetchInterval: 30_000,
})

export const profileQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['characters', id, 'profile'],
    queryFn: () => apiFetch<CharacterProfile>(`/characters/${encodeURIComponent(id)}/profile`),
  })

export const hallOfFameQueryOptions = queryOptions({
  queryKey: ['hall-of-fame'],
  queryFn: () => apiFetch<HallOfFame>('/hall-of-fame'),
})

export function useSetHideGms() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (settings: HallOfFameSettings) =>
      apiFetch<HallOfFameSettings>('/gm/hall-of-fame/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: hallOfFameQueryOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: overviewQueryOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: ['characters'] }),
      ]),
  })
}

/** The API writes this one for the GM. */
export const settingsErrorMessage = (err: unknown) =>
  err instanceof ApiError && err.status === 503 ? err.message : 'Something went wrong. Please try again.'

export const isNotFound = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 400)

export function ordinal(place: number) {
  const lastTwo = place % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${place}th`
  const suffixes: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' }
  return `${place}${suffixes[place % 10] ?? 'th'}`
}

export function formatMinutes(total: number) {
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

// These are the server's clock, not the browser's, so UTC only does the arithmetic.
const wallClockMs = (value: string) => Date.parse(`${value.length === 10 ? `${value}T00:00` : value}:00Z`)

/** Time left between two server clock times, in its largest useful unit. */
export function formatTimeLeft(from: string, until: string) {
  const minutes = Math.round((wallClockMs(until) - wallClockMs(from)) / 60_000)
  if (minutes < 1) return 'soon'
  if (minutes >= 24 * 60) return `in ${Math.floor(minutes / (24 * 60))}d`
  return `in ${formatMinutes(minutes)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const formatDay = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`

/** The grid's dates, oldest first: 53 weeks, starting on a Sunday and ending on `today`. */
export function calendarDays(today: string): string[] {
  const end = wallClockMs(today)
  const day = 24 * 60 * 60 * 1000
  const startOfThisWeek = end - new Date(end).getUTCDay() * day
  const start = startOfThisWeek - 52 * 7 * day
  const days: string[] = []
  for (let ms = start; ms <= end; ms += day) days.push(new Date(ms).toISOString().slice(0, 10))
  return days
}
