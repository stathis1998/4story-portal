import type { GmWheel, WheelPrizeInput, WheelSpinResult, WheelState } from '@4story-portal/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'

export const wheelQueryOptions = queryOptions({
  queryKey: ['wheel'],
  queryFn: () => apiFetch<WheelState>('/wheel'),
  // Picks up a GM switching the wheel on or changing a prize.
  refetchInterval: 60_000,
})

export const spinWheel = (characterId: number) =>
  apiFetch<WheelSpinResult>('/wheel/spin', { method: 'POST', body: JSON.stringify({ characterId }) })

export const gmWheelQueryOptions = queryOptions({
  queryKey: ['gm', 'wheel'],
  queryFn: () => apiFetch<GmWheel>('/gm/wheel'),
  refetchInterval: 10_000,
})

type GmChange =
  | { kind: 'live'; live: boolean }
  | { kind: 'add'; prize: WheelPrizeInput }
  | { kind: 'save'; id: number; prize: WheelPrizeInput }
  | { kind: 'delete'; id: number }

const send = (change: GmChange) => {
  switch (change.kind) {
    case 'live':
      return apiFetch<GmWheel>('/gm/wheel/live', { method: 'PUT', body: JSON.stringify({ live: change.live }) })
    case 'add':
      return apiFetch<GmWheel>('/gm/wheel/prizes', { method: 'POST', body: JSON.stringify(change.prize) })
    case 'save':
      return apiFetch<GmWheel>(`/gm/wheel/prizes/${change.id}`, { method: 'PUT', body: JSON.stringify(change.prize) })
    case 'delete':
      return apiFetch<GmWheel>(`/gm/wheel/prizes/${change.id}`, { method: 'DELETE' })
  }
}

/** Every change answers with the whole GM state, so it replaces what the page shows without a refetch. */
export function useChangeWheel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'wheel', 'change'],
    mutationFn: send,
    onSuccess: async (state) => {
      // A poll already on its way would put the old state back over this answer.
      await queryClient.cancelQueries({ queryKey: gmWheelQueryOptions.queryKey })
      queryClient.setQueryData(gmWheelQueryOptions.queryKey, state)
      // Players see the prizes and the switch too.
      void queryClient.invalidateQueries({ queryKey: wheelQueryOptions.queryKey })
    },
  })
}

/** What the API said, when it was a refusal a person can act on. */
export const wheelErrorMessage = (err: unknown) =>
  err instanceof ApiError && (err.status < 500 || err.status === 503) ? err.message : 'Something went wrong. Please try again.'

/** `12.5%`, `1%`, and `0.4%` instead of a rounded-away 0. */
export function formatChance(percent: number): string {
  const digits = percent > 0 && percent < 1 ? 2 : 1
  return `${Number(percent.toFixed(digits))}%`
}

/** `14:03:22`, never below zero. */
export function formatCountdown(seconds: number): string {
  const left = Math.max(0, Math.floor(seconds))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `14 Nov, 10:05` from the server's clock, which the API sends as if it were UTC. */
export const formatSpinTime = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}, ${iso.slice(11, 16)}`

/** How long the wheel takes to turn to its prize. */
export const SPIN_SECONDS = 5

// The wheel's geometry. Angles are in degrees, clockwise from the top, where the pointer is.

/** The point at `angle` on a circle of `radius` around (`center`, `center`). */
export function pointAt(angle: number, radius: number, center: number): [number, number] {
  const radians = (angle * Math.PI) / 180
  return [center + radius * Math.sin(radians), center - radius * Math.cos(radians)]
}

/** The SVG path of segment `index` out of `count`: a wedge, or the whole disc for a lone prize. */
export function segmentPath(index: number, count: number, radius: number, center: number): string {
  const fixed = (value: number) => Number(value.toFixed(2))
  if (count <= 1) {
    return `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center} ${center + radius} A ${radius} ${radius} 0 1 1 ${center} ${center - radius} Z`
  }
  const step = 360 / count
  const [x1, y1] = pointAt(index * step, radius, center).map(fixed)
  const [x2, y2] = pointAt((index + 1) * step, radius, center).map(fixed)
  return `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${step > 180 ? 1 : 0} 1 ${x2} ${y2} Z`
}

/** Where the middle of segment `index` sits, before the wheel is turned. */
export const segmentAngle = (index: number, count: number) => ((index + 0.5) * 360) / count

/**
 * How far the wheel must be turned, in all, to stop with segment `index` under the pointer: always
 * forward from `current`, by at least `turns` whole turns.
 */
export function nextRotation(current: number, index: number, count: number, turns = 5): number {
  const rest = -segmentAngle(index, count)
  return rest + 360 * Math.ceil((current + turns * 360 - rest) / 360)
}

/** A name short enough to fit along a segment. */
export const segmentLabel = (name: string, max = 22) => (name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name)
