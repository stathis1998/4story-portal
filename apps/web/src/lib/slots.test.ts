import type { SlotStops } from '@4story-portal/shared'
import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { planReels, reelStop, reelTimes, reelsAt, restTimes, slotsErrorMessage, suspenseReels } from './slots'

const FRAME = 1 / 60
const NONE = [false, false, false, false, false]
const NORMAL = reelTimes(NONE, false)
const QUICK = reelTimes(NONE, true)
const SUSPENSE = reelTimes([true, true, false, false, false], false)
const CASES: [SlotStops, SlotStops][] = [
  [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  [[3, 30, 11, 0, 17], [5, 0, 20, 31, 2]],
  [[31, 31, 31, 31, 31], [0, 1, 2, 3, 4]],
  [[7, 12, 25, 1, 9], [6, 31, 24, 0, 8]],
]
const TIMES: [string, number[]][] = [
  ['normal', NORMAL],
  ['quick', QUICK],
  ['in suspense', SUSPENSE],
]
/** Every case at every set of times. */
const ALL = TIMES.flatMap(([name, times]) => CASES.map(([from, to]) => [name, times, from, to] as const))

/** Every frame of a spin at 60 frames a second, and a little past the end. */
const frames = (from: SlotStops, to: SlotStops, times: readonly number[]) => {
  const plan = planReels(from, to, times)
  return Array.from({ length: Math.round((Math.max(...times) + 0.5) / FRAME) + 1 }, (_, i) => reelsAt(plan, i * FRAME))
}

describe('the times the reels stop', () => {
  it.each([
    [[false, false, false, false, false], false, [1, 1.5, 2, 2.5, 3]],
    [[false, false, false, false, false], true, [0.5, 0.75, 1, 1.25, 1.5]],
    [[true, true, false, false, false], false, [1, 1.5, 3, 4.5, 6]],
    [[false, true, false, true, false], false, [1, 1.5, 2, 2.5, 4]],
    [[true, false, false, false, true], false, [1, 1.5, 2, 2.5, 3]],
    [[true, true, false, false, false], true, [0.5, 0.75, 1.5, 2.25, 3]],
  ])('reel times for scatters %j, quick %s', (scatters, quick, times) => {
    expect(reelTimes(scatters, quick)).toEqual(times)
  })

  it.each([
    [[true, true, false, false, false], [2, 3, 4]],
    [[false, true, false, true, false], [4]],
    [[true, false, false, false, true], []],
    [[false, false, false, false, false], []],
  ])('suspense reels for scatters %j', (scatters, reels) => {
    expect(suspenseReels(scatters)).toEqual(reels)
  })
})

describe('the slot reels', () => {
  it('turns a position into the stop on the win line, symbols moving downward as it grows', () => {
    expect(reelStop(0)).toBe(0)
    expect(reelStop(1)).toBe(31)
    expect(reelStop(32)).toBe(0)
    expect(reelStop(35)).toBe(29)
    // The letter above the win line is the stop before it: one step on, it is the one on the line.
    expect(reelStop(10 + 1)).toBe((reelStop(10) + 31) % 32)
  })

  it('starts on the stops it was given', () => {
    const start = reelsAt(planReels([3, 30, 11, 0, 17], [5, 0, 20, 31, 2], NORMAL), 0)
    expect(start.map(reelStop)).toEqual([3, 30, 11, 0, 17])
    expect(start.every(Number.isInteger)).toBe(true)
  })

  it.each(ALL)('ends on its stops (%s, %j to %j)', (_, times, from, to) => {
    const plan = planReels(from, to, times)
    const end = reelsAt(plan, Math.max(...times))
    expect(end.map(reelStop)).toEqual(to)
    expect(end.every(Number.isInteger)).toBe(true)
    expect(reelsAt(plan, Math.max(...times) + 3)).toEqual(end)
  })

  it.each(TIMES)('brings each reel to rest at its own time (%s)', (_, times) => {
    const plan = planReels([3, 30, 11, 0, 17], [5, 0, 20, 31, 2], times)
    const end = reelsAt(plan, Math.max(...times))
    times.forEach((at, i) => {
      expect(reelsAt(plan, at)[i]).toBe(end[i])
      expect(reelsAt(plan, at + 0.5)[i]).toBe(end[i])
      // A moment before, it is still moving.
      expect(reelsAt(plan, at - 0.05)[i]).not.toBe(end[i])
      expect(reelsAt(plan, at - 0.05)[i]).not.toBeCloseTo(reelsAt(plan, at - 0.03)[i], 3)
    })
  })

  it('starts the reels together with an ease-in, not at full speed', () => {
    const plan = planReels([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], NORMAL)
    const first = reelsAt(plan, FRAME)
    const cruise = reelsAt(plan, 0.3)
    const cruiseNext = reelsAt(plan, 0.3 + FRAME)
    first.forEach((p, i) => {
      expect(p).toBeGreaterThan(0)
      expect(p).toBeLessThan(0.3 * (cruiseNext[i] - cruise[i]))
    })
  })

  it.each(ALL)('turns each reel its whole loops, and a later reel never less than an earlier one (%s, %j to %j)', (_, times, from, to) => {
    const plan = planReels(from, to, times)
    const travel = reelsAt(plan, Math.max(...times)).map((p, i) => p - reelsAt(plan, 0)[i])
    travel.forEach((t, i) => {
      expect(t).toBeGreaterThanOrEqual(Math.max(1, Math.round(times[i] * 2)) * 32)
      if (i > 0) expect(t).toBeGreaterThanOrEqual(travel[i - 1])
    })
  })

  it('keeps the speed about even: the loops grow with the time', () => {
    const plan = planReels([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], NORMAL)
    expect(plan.travel).toEqual([64, 96, 128, 160, 192])
    expect(planReels([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], SUSPENSE).travel).toEqual([64, 96, 192, 288, 384])
  })

  it.each(ALL)('never moves a reel backward, apart from the settle (%s, %j to %j)', (_, times, from, to) => {
    const all = frames(from, to, times)
    for (let r = 0; r < 5; r++) {
      let back = 0
      for (let i = 1; i < all.length; i++) back += Math.max(0, all[i - 1][r] - all[i][r])
      expect(back).toBeLessThan(0.34)
    }
  })

  it.each(ALL)('moves a reel at most four stops a frame (%s, %j to %j)', (_, times, from, to) => {
    // The strongest blur smears a fast reel over about a symbol, so it never strobes.
    const all = frames(from, to, times)
    for (let i = 1; i < all.length; i++)
      for (let r = 0; r < 5; r++) expect(Math.abs(all[i][r] - all[i - 1][r])).toBeLessThanOrEqual(4)
  })

  it.each(ALL)('overshoots by less than a third of a symbol (%s, %j to %j)', (_, times, from, to) => {
    const all = frames(from, to, times)
    const end = all[all.length - 1]
    for (let r = 0; r < 5; r++) {
      const most = Math.max(...all.map((f) => f[r] - end[r]))
      expect(most).toBeGreaterThan(0.05)
      expect(most).toBeLessThan(1 / 3)
    }
  })

  it.each(ALL)('does not speed up again once a reel has started slowing (%s, %j to %j)', (_, times, from, to) => {
    const all = frames(from, to, times)
    for (let r = 0; r < 5; r++) {
      const steps = all.slice(1).map((f, i) => f[r] - all[i][r])
      const peak = Math.max(...steps)
      // The first frame at full speed; from there the steps only shrink until the reel turns back for its settle.
      let i = steps.findIndex((s) => s > peak - 1e-6)
      expect(i).toBeGreaterThan(0)
      for (i++; i < steps.length && steps[i] > 0; i++) expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-9)
      expect(i).toBeLessThan(steps.length)
    }
  })
})

describe('stopping the reels at once', () => {
  const from: SlotStops = [3, 30, 11, 0, 17]
  const to: SlotStops = [5, 0, 20, 31, 2]
  const plan = planReels(from, to, NORMAL)
  const end = reelsAt(plan, 3)

  it('leaves the reels already at rest and settles the others onto their stops', () => {
    const rests = restTimes(plan, 1.7)
    // Reels 1 and 2 had stopped; the rest drop back onto their stops after a short settle.
    expect(rests.slice(0, 2)).toEqual([1, 1.5])
    rests.slice(2).forEach((t) => {
      expect(t).toBeGreaterThan(1.7)
      expect(t).toBeLessThan(2)
    })
    const settled = reelsAt(plan, Math.max(...rests), 1.7)
    expect(settled).toEqual(end)
    expect(settled.map(reelStop)).toEqual(to)
  })

  it('jumps a turning reel ahead to just past its stop, never back', () => {
    const before = reelsAt(plan, 1.7)
    const now = reelsAt(plan, 1.7, 1.7)
    for (let r = 2; r < 5; r++) {
      expect(now[r]).toBeGreaterThan(before[r])
      expect(now[r] - end[r]).toBeGreaterThan(0)
      expect(now[r] - end[r]).toBeLessThan(1 / 3)
    }
    // From there it only drops back onto its stop.
    let last = now
    for (let t = 1.7 + FRAME; t < 2; t += FRAME) {
      const next = reelsAt(plan, t, 1.7)
      for (let r = 2; r < 5; r++) expect(next[r]).toBeLessThanOrEqual(last[r])
      last = next
    }
  })

  it('changes nothing when every reel had already stopped', () => {
    expect(restTimes(plan, 3)).toEqual(NORMAL)
    expect(reelsAt(plan, 3.2, 3)).toEqual(end)
    expect(restTimes(plan)).toEqual(NORMAL)
  })
})

describe('slotsErrorMessage', () => {
  it('passes on a refusal a person can act on', () => {
    expect(slotsErrorMessage(new ApiError(400, 'Stake is not offered'))).toBe('Stake is not offered')
    expect(slotsErrorMessage(new ApiError(503, 'The floor is closed'))).toBe('The floor is closed')
  })

  it('hides a failure on the server', () => {
    expect(slotsErrorMessage(new ApiError(500, 'boom'))).toBe('Something went wrong. Please try again.')
    expect(slotsErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.')
  })
})
