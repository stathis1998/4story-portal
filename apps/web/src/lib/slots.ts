import { SLOT_REEL_STOPS } from '@4story-portal/shared'
import type { GmSlots, SlotMachineKey, SlotMachineSettingsInput, SlotPotsSettingsInput, SlotSpinRequest, SlotSpinResult, SlotStops, SlotsState } from '@4story-portal/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'

export const slotsQueryOptions = queryOptions({
  queryKey: ['slots'],
  queryFn: () => apiFetch<SlotsState>('/slots'),
  // Picks up a GM opening or closing the floor or a machine, or changing a stake. It also keeps the pots up with the other players.
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
  | { kind: 'jackpots'; settings: SlotPotsSettingsInput }
  | { kind: 'daily'; rounds: number }

/** Each save answers with the whole GM state, so it replaces what the page shows without a refetch. */
export function useSaveSlots() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'slots', 'save'],
    mutationFn: (save: SlotsSave) => {
      if (save.kind === 'floor') return apiFetch<GmSlots>('/gm/slots/floor', { method: 'PUT', body: JSON.stringify({ live: save.live }) })
      if (save.kind === 'jackpots') return apiFetch<GmSlots>('/gm/slots/jackpots', { method: 'PUT', body: JSON.stringify(save.settings) })
      if (save.kind === 'daily') return apiFetch<GmSlots>('/gm/slots/daily', { method: 'PUT', body: JSON.stringify({ rounds: save.rounds }) })
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

/** Seconds until reel 1 rests. */
export const SLOT_FIRST_STOP = 1.0
/** Seconds between one reel resting and the next. */
export const SLOT_STOP_GAP = 0.5
/** Added before each reel that turns while two scatters already show. */
export const SLOT_SUSPENSE = 1.0

/** The reels that turn in suspense: every reel after the one that showed the second scatter. */
export function suspenseReels(scatterOnReel: readonly boolean[]): number[] {
  let seen = 0
  const second = scatterOnReel.findIndex((scatter) => scatter && ++seen === 2)
  if (second < 0) return []
  return scatterOnReel.map((_, i) => i).filter((i) => i > second)
}

/** When each reel rests. `scatterOnReel[i]` is whether reel i shows a scatter. Quick halves all three times. */
export function reelTimes(scatterOnReel: readonly boolean[], quick: boolean): number[] {
  const scale = quick ? 0.5 : 1
  const suspense = new Set(suspenseReels(scatterOnReel))
  const times: number[] = []
  scatterOnReel.forEach((_, i) => {
    const wait = i === 0 ? SLOT_FIRST_STOP : SLOT_STOP_GAP + (suspense.has(i) ? SLOT_SUSPENSE : 0)
    times.push((times[i - 1] ?? 0) + wait * scale)
  })
  return times
}

/** The ease-in from rest to full speed, the run down from full speed to a halt just past the stop, the settle back onto it. */
const RAMP = 0.15
const SLOW = 0.4
const SETTLE = 0.18
/** How far past its stop a reel runs before it drops back, in stops. */
const OVERSHOOT = 0.2
/**
 * A reel resting sooner than this has its ramp, slow-down and settle shortened in proportion: a quick spin's first
 * reel rests at half a second, less than the three together.
 */
const FULL_EASE = 1.0

/**
 * `start` and `travel` are the reels' positions at rest before the spin and how far each turns, which ends on `to`.
 * `times` is when each rests, in seconds.
 */
export type ReelPlan = { from: SlotStops; to: SlotStops; start: number[]; travel: number[]; times: number[] }

/** The stop on the win line for a reel at rest at the whole number `position`, from 0 to 31. */
export function reelStop(position: number): number {
  return (((-position % SLOT_REEL_STOPS) + SLOT_REEL_STOPS) % SLOT_REEL_STOPS)
}

/** A spin that starts with the reels resting on `from` and ends with them resting on `to`, each at its time in `times`. */
export function planReels(from: SlotStops, to: SlotStops, times: readonly number[]): ReelPlan {
  // Resting on stop s is the position -s, so the start is kept non-negative and a position grows with time.
  const start = from.map((s) => (SLOT_REEL_STOPS - s) % SLOT_REEL_STOPS)
  const travel: number[] = []
  let loops = 1
  to.forEach((s, i) => {
    const toGo = (((SLOT_REEL_STOPS - s - start[i]) % SLOT_REEL_STOPS) + SLOT_REEL_STOPS) % SLOT_REEL_STOPS
    // About two loops a second, so a reel that turns longer runs further and the speed stays about even.
    loops = Math.max(loops, Math.round(times[i] * 2))
    let distance = loops * SLOT_REEL_STOPS + toGo
    // Two reels on the same loops: a later one is never seen running behind an earlier one.
    while (i > 0 && distance < travel[i - 1]) distance += SLOT_REEL_STOPS
    travel.push(distance)
  })
  return { from, to, start, travel, times: [...times] }
}

/**
 * How far a reel has turned `t` seconds into its spin, of `travel` stops in `total` seconds. It eases in to a
 * steady speed, holds it, then slows evenly to a halt OVERSHOOT past the stop and drops back onto it, so it only
 * ever slows once it has begun to.
 */
function turned(travel: number, total: number, t: number): number {
  if (t >= total) return travel
  const fit = Math.min(1, total / FULL_EASE)
  const ramp = RAMP * fit
  const slow = SLOW * fit
  const settle = SETTLE * fit
  const aim = travel + OVERSHOOT
  const run = total - settle
  // The distance is the area under the speed: a ramp up, a plateau, a ramp down.
  const speed = aim / (run - (ramp + slow) / 2)
  if (t <= ramp) return (speed * t * t) / (2 * ramp)
  if (t <= run - slow) return speed * (ramp / 2 + (t - ramp))
  if (t <= run) {
    const left = run - t
    return aim - (speed * left * left) / (2 * slow)
  }
  return travel + dropBack((t - run) / settle)
}

/** Back from the overshoot, starting and ending at a standstill: `u` runs from 0 to 1 over the settle. */
const dropBack = (u: number) => (u >= 1 ? 0 : (OVERSHOOT * (1 + Math.cos(Math.PI * u))) / 2)

/**
 * When each reel is at rest in a spin stopped at once `stopAt` seconds in: a reel already resting keeps its time,
 * one still turning rests after the settle. Without `stopAt`, the plan's own times.
 */
export function restTimes(plan: ReelPlan, stopAt = Infinity): number[] {
  return plan.times.map((time) => (time <= stopAt ? time : stopAt + SETTLE))
}

/**
 * Where each reel is `seconds` into the spin: fractional while it moves, a whole number once at rest. A spin
 * stopped at once `stopAt` seconds in puts every reel still turning just past its stop, to drop back onto it.
 */
export function reelsAt(plan: ReelPlan, seconds: number, stopAt = Infinity): number[] {
  const t = Math.max(seconds, 0)
  return plan.travel.map((travel, i) => {
    if (t >= stopAt && plan.times[i] > stopAt) return plan.start[i] + travel + dropBack((t - stopAt) / SETTLE)
    return plan.start[i] + turned(travel, plan.times[i], t)
  })
}
