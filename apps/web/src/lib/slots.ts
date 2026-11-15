import { SLOT_REEL_STOPS } from '@4story-portal/shared'
import type { GmSlots, SlotMachineKey, SlotJackpotSettingsInput, SlotMachineSettingsInput, SlotSpinRequest, SlotSpinResult, SlotStops, SlotsState } from '@4story-portal/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'

export const slotsQueryOptions = queryOptions({
  queryKey: ['slots'],
  queryFn: () => apiFetch<SlotsState>('/slots'),
  // Picks up a GM opening or closing the floor or a machine, or changing a stake. It also keeps the pot up with the other players.
  refetchInterval: 15_000,
})

export const spinSlots = (request: SlotSpinRequest) =>
  apiFetch<SlotSpinResult>('/slots/spin', { method: 'POST', body: JSON.stringify(request) })

export const gmSlotsQueryOptions = queryOptions({
  queryKey: ['gm', 'slots'],
  queryFn: () => apiFetch<GmSlots>('/gm/slots'),
  refetchInterval: 10_000,
})

type SlotsSave =
  | { kind: 'floor'; live: boolean }
  | { kind: 'machine'; key: SlotMachineKey; settings: SlotMachineSettingsInput }
  | { kind: 'jackpot'; settings: SlotJackpotSettingsInput }

/** Each save answers with the whole GM state, so it replaces what the page shows without a refetch. */
export function useSaveSlots() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'slots', 'save'],
    mutationFn: (save: SlotsSave) => {
      if (save.kind === 'floor') return apiFetch<GmSlots>('/gm/slots/floor', { method: 'PUT', body: JSON.stringify({ live: save.live }) })
      if (save.kind === 'jackpot') return apiFetch<GmSlots>('/gm/slots/jackpot', { method: 'PUT', body: JSON.stringify(save.settings) })
      return apiFetch<GmSlots>(`/gm/slots/machines/${save.key}`, { method: 'PUT', body: JSON.stringify(save.settings) })
    },
    onSuccess: async (state) => {
      // A poll already on its way would put the old state back over this answer.
      await queryClient.cancelQueries({ queryKey: gmSlotsQueryOptions.queryKey })
      queryClient.setQueryData(gmSlotsQueryOptions.queryKey, state)
      // Players see the switches and the stakes too.
      void queryClient.invalidateQueries({ queryKey: slotsQueryOptions.queryKey })
    },
  })
}

/** What the API said, when it was a refusal a person can act on. */
export const slotsErrorMessage = (err: unknown) =>
  err instanceof ApiError && (err.status < 500 || err.status === 503) ? err.message : 'Something went wrong. Please try again.'

// The reels' motion. A position is a place on a reel's strip, in stops.
//
// A growing position moves the symbols DOWNWARD through the window, as on a real reel. Draw a strip as a
// column of its 32 letters with letter 0 at the top, and translate it down by `position` stops (looping): the
// letter above the win line is then the next to arrive on it, so the stop on the win line gets SMALLER as the
// position grows. reelStop is exactly that: stop = -position, wrapped into 0..31.

/** When each reel comes to rest, in seconds; the last is the length of a spin. */
export const SLOT_REEL_SECONDS = [1.3, 1.9, 2.5] as const
export const SLOT_SPIN_SECONDS = 2.5

/** The ease-in from rest to full speed, the run down from full speed to a halt just past the stop, the settle back onto it. */
const RAMP = 0.15
const SLOW = 0.4
const SETTLE = 0.18
/** How far past its stop a reel runs before it drops back, in stops. */
const OVERSHOOT = 0.2
/** Whole loops a reel turns before the turns it needs to reach its stop: later reels run further, so the order of stopping is also the order of distance. */
const FIRST_LOOPS = 2

/** `start` and `travel` are the reels' positions at rest before the spin and how far each turns, which ends on `to`. */
export type ReelPlan = { from: SlotStops; to: SlotStops; start: SlotStops; travel: SlotStops; [key: string]: number | SlotStops }

/** The stop on the win line for a reel at rest at the whole number `position`, from 0 to 31. */
export function reelStop(position: number): number {
  return (((-position % SLOT_REEL_STOPS) + SLOT_REEL_STOPS) % SLOT_REEL_STOPS)
}

/** A spin that starts with the reels resting on `from` and ends with them resting on `to`. */
export function planReels(from: SlotStops, to: SlotStops): ReelPlan {
  // Resting on stop s is the position -s, so the start is kept non-negative and a position grows with time.
  const start = from.map((s) => (SLOT_REEL_STOPS - s) % SLOT_REEL_STOPS) as SlotStops
  const travel = to.map((s, i) => {
    const toGo = (((SLOT_REEL_STOPS - s - start[i]) % SLOT_REEL_STOPS) + SLOT_REEL_STOPS) % SLOT_REEL_STOPS
    return (FIRST_LOOPS + i) * SLOT_REEL_STOPS + toGo
  }) as SlotStops
  return { from, to, start, travel }
}

/**
 * How far a reel has turned `t` seconds into its spin, of `travel` stops in `total` seconds. It eases in to a
 * steady speed, holds it, then slows evenly to a halt OVERSHOOT past the stop and drops back onto it, so it only
 * ever slows once it has begun to.
 */
function turned(travel: number, total: number, t: number): number {
  if (t >= total) return travel
  const aim = travel + OVERSHOOT
  const run = total - SETTLE
  // The distance is the area under the speed: a ramp up, a plateau, a ramp down.
  const speed = aim / (run - (RAMP + SLOW) / 2)
  if (t <= RAMP) return (speed * t * t) / (2 * RAMP)
  if (t <= run - SLOW) return speed * (RAMP / 2 + (t - RAMP))
  if (t <= run) {
    const left = run - t
    return aim - (speed * left * left) / (2 * SLOW)
  }
  // Back from the overshoot, starting and ending at a standstill.
  const u = (t - run) / SETTLE
  return travel + (OVERSHOOT * (1 + Math.cos(Math.PI * u))) / 2
}

/** Where each reel is `seconds` into the spin: fractional while it moves, a whole number once at rest. */
export function reelsAt(plan: ReelPlan, seconds: number): [number, number, number] {
  const t = Math.max(seconds, 0)
  return [0, 1, 2].map((i) => plan.start[i] + turned(plan.travel[i], SLOT_REEL_SECONDS[i], t)) as [number, number, number]
}
