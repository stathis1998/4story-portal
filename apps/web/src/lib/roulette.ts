import { ROULETTE_POCKETS } from '@4story-portal/shared'
import type { GmRoulette, RouletteBet, RouletteSettingsInput, RouletteSpinResult, RouletteState } from '@4story-portal/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from './api'

export const rouletteQueryOptions = queryOptions({
  queryKey: ['roulette'],
  queryFn: () => apiFetch<RouletteState>('/roulette'),
  // Picks up a GM opening or closing the table or changing a limit.
  refetchInterval: 60_000,
})

export const spinRoulette = (characterId: number, bets: RouletteBet[]) =>
  apiFetch<RouletteSpinResult>('/roulette/spin', { method: 'POST', body: JSON.stringify({ characterId, bets }) })

export const gmRouletteQueryOptions = queryOptions({
  queryKey: ['gm', 'roulette'],
  queryFn: () => apiFetch<GmRoulette>('/gm/roulette'),
  refetchInterval: 10_000,
})

/** The save answers with the whole GM state, so it replaces what the page shows without a refetch. */
export function useSaveRouletteSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['gm', 'roulette', 'settings'],
    mutationFn: (settings: RouletteSettingsInput) =>
      apiFetch<GmRoulette>('/gm/roulette/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    onSuccess: async (state) => {
      // A poll already on its way would put the old state back over this answer.
      await queryClient.cancelQueries({ queryKey: gmRouletteQueryOptions.queryKey })
      queryClient.setQueryData(gmRouletteQueryOptions.queryKey, state)
      // Players see the switch and the limits too.
      void queryClient.invalidateQueries({ queryKey: rouletteQueryOptions.queryKey })
    },
  })
}

/** What the API said, when it was a refusal a person can act on. */
export const rouletteErrorMessage = (err: unknown) =>
  err instanceof ApiError && (err.status < 500 || err.status === 503) ? err.message : 'Something went wrong. Please try again.'

// The wheel's motion. Angles are in degrees, clockwise from the top; depth 0 is the ball track, 1 the pocket.

export const ROULETTE_SPIN_SECONDS = 8

const POCKET_STEP = 360 / ROULETTE_POCKETS.length

/** Degrees clockwise from the top to the middle of a pocket, on a wheel that has not turned. */
export const pocketAngle = (pocket: number) => ROULETTE_POCKETS.indexOf(pocket) * POCKET_STEP

/** How far the wheel turns in a spin. It slows evenly, as friction would, and stops at the end. */
const WHEEL_TURN = 2.5 * 360
/** The ball leaves the track, reaches the pockets, ends its hop, and is still. */
const DROP = 5
const LAND = 6.3
const HOP = 0.5
const SETTLE = 7.1
/** Where the ball is launched from, on the page. */
const LAUNCH = 0
/** Its launch speed in degrees a second is the slowest that still lands it in the pocket, from this up. */
const MIN_LAUNCH_SPEED = 600
/** The share of its launch speed the ball still has when it leaves the track. */
const SPEED_AT_DROP = 0.35
/** How far the two bounces lift the ball out of the pocket, as a share of the depth. */
const FIRST_BOUNCE = 0.25
const SECOND_BOUNCE = 0.08
/** How far the ball rocks in its pocket on the second bounce. */
const ROCK = 1.5

export type SpinPlan = { pocket: number; wheelFrom: number; [key: string]: number }

const wheelAt = (wheelFrom: number, t: number) => wheelFrom + WHEEL_TURN * (1 - (1 - t / ROULETTE_SPIN_SECONDS) ** 2)
const wheelSpeedAt = (t: number) => ((2 * WHEEL_TURN) / ROULETTE_SPIN_SECONDS) * (1 - t / ROULETTE_SPIN_SECONDS)

/**
 * A spin that starts with the wheel at wheelFrom degrees and ends with the ball in `pocket`. The ball's
 * launch speed is what makes it land in the right pocket: it is solved for here, so frameAt stays cheap.
 */
export function planSpin(pocket: number, wheelFrom: number): SpinPlan {
  const index = ROULETTE_POCKETS.indexOf(pocket)
  // The ball first lands 0, 1 or 2 pockets clockwise of its own and hops over, so spins do not all look alike.
  const hop = ((((Math.floor(wheelFrom) + index) % 3) + 3) % 3) * POCKET_STEP
  // The ball meets the pockets already moving at the speed of its hop, so it does not stop and start.
  const landSpeed = wheelSpeedAt(LAND) - hop / HOP
  const drop = LAND - DROP
  // Where the ball is when it lands, less where it started, is landSpeed * drop / 3 - launchSpeed * travel.
  const travel = (DROP * (1 + SPEED_AT_DROP)) / 2 + (2 * SPEED_AT_DROP * drop) / 3
  const short = LAUNCH + (landSpeed * drop) / 3 - wheelAt(wheelFrom, LAND) - pocketAngle(pocket) - hop
  // Whole turns of the ball the launch speed can add or lose, chosen to keep it at or above the minimum.
  const turns = Math.floor((short - MIN_LAUNCH_SPEED * travel) / 360)
  return {
    pocket,
    wheelFrom,
    hop,
    landSpeed,
    launchSpeed: (short - 360 * turns) / travel,
    // The ball's angle less the wheel's once it is in its pocket.
    ballOffset: pocketAngle(pocket) + 360 * turns,
  }
}

/**
 * Where things are `seconds` into the spin. The ball runs anticlockwise on the track, slowing evenly; from
 * second 5 it rolls inward faster and faster while the pockets drag it round with the wheel; it lands, hops
 * into its own pocket, rocks once and then rides with the wheel until both stop at ROULETTE_SPIN_SECONDS.
 */
export function frameAt(plan: SpinPlan, seconds: number): { wheel: number; ball: number; depth: number } {
  const t = Math.min(Math.max(seconds, 0), ROULETTE_SPIN_SECONDS)
  const wheel = wheelAt(plan.wheelFrom, t)
  const speed = plan.launchSpeed
  if (t <= DROP) {
    const ball = LAUNCH - speed * (t - ((1 - SPEED_AT_DROP) * t * t) / (2 * DROP))
    return { wheel, ball, depth: 0 }
  }
  const settled = wheel + plan.ballOffset
  if (t <= LAND) {
    // Its speed moves from the track's to the pockets' as fast as it moves inward.
    const drop = LAND - DROP
    const into = t - DROP
    const x = into / drop
    const atDrop = LAUNCH - (speed * DROP * (1 + SPEED_AT_DROP)) / 2
    const dropSpeed = speed * SPEED_AT_DROP
    const ball = atDrop - dropSpeed * into + ((dropSpeed + plan.landSpeed) * x ** 3 * drop) / 3
    return { wheel, ball, depth: x * x }
  }
  if (t <= LAND + HOP) {
    const y = (t - LAND) / HOP
    return { wheel, ball: settled + plan.hop * (1 - y), depth: 1 - FIRST_BOUNCE * 4 * y * (1 - y) }
  }
  if (t < SETTLE) {
    const z = (t - LAND - HOP) / (SETTLE - LAND - HOP)
    return { wheel, ball: settled + ROCK * Math.sin(Math.PI * z), depth: 1 - SECOND_BOUNCE * 4 * z * (1 - z) }
  }
  return { wheel, ball: settled, depth: 1 }
}
