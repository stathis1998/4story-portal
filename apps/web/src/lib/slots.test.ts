import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { SLOT_REEL_SECONDS, SLOT_SPIN_SECONDS, planReels, reelStop, reelsAt, slotsErrorMessage } from './slots'

const FRAME = 1 / 60
const CASES: [[number, number, number], [number, number, number]][] = [
  [[0, 0, 0], [0, 0, 0]],
  [[3, 30, 11], [5, 0, 20]],
  [[31, 31, 31], [0, 1, 2]],
  [[7, 12, 25], [6, 31, 24]],
]

/** Every frame of a spin at 60 frames a second, and a little past the end. */
const frames = (from: [number, number, number], to: [number, number, number]) => {
  const plan = planReels(from, to)
  return Array.from({ length: Math.round((SLOT_SPIN_SECONDS + 0.5) / FRAME) + 1 }, (_, i) => reelsAt(plan, i * FRAME))
}

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
    const start = reelsAt(planReels([3, 30, 11], [5, 0, 20]), 0)
    expect(start.map(reelStop)).toEqual([3, 30, 11])
    expect(start.every(Number.isInteger)).toBe(true)
  })

  it.each(CASES)('ends on its stops (%j to %j)', (from, to) => {
    const end = reelsAt(planReels(from, to), SLOT_SPIN_SECONDS)
    expect(end.map(reelStop)).toEqual(to)
    expect(end.every(Number.isInteger)).toBe(true)
    expect(reelsAt(planReels(from, to), SLOT_SPIN_SECONDS + 3)).toEqual(end)
  })

  it('brings the reels to rest left to right, each at its own time', () => {
    const plan = planReels([3, 30, 11], [5, 0, 20])
    const end = reelsAt(plan, SLOT_SPIN_SECONDS)
    SLOT_REEL_SECONDS.forEach((at, i) => {
      expect(reelsAt(plan, at)[i]).toBe(end[i])
      expect(reelsAt(plan, at + 0.5)[i]).toBe(end[i])
      // A moment before, it is still moving.
      expect(reelsAt(plan, at - 0.1)[i]).not.toBe(end[i])
      expect(reelsAt(plan, at - 0.1)[i]).not.toBeCloseTo(reelsAt(plan, at - 0.05)[i], 3)
    })
  })

  it('starts the reels together with an ease-in, not at full speed', () => {
    const plan = planReels([0, 0, 0], [0, 0, 0])
    const first = reelsAt(plan, FRAME)
    const cruise = reelsAt(plan, 0.6)
    const cruiseNext = reelsAt(plan, 0.6 + FRAME)
    first.forEach((p, i) => {
      expect(p).toBeGreaterThan(0)
      expect(p).toBeLessThan(0.3 * (cruiseNext[i] - cruise[i]))
    })
  })

  it.each(CASES)('turns every reel at least two full loops, later reels further (%j to %j)', (from, to) => {
    const first = frames(from, to)[0]
    const end = reelsAt(planReels(from, to), SLOT_SPIN_SECONDS)
    const travel = end.map((p, i) => p - first[i])
    expect(travel.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(64)
    travel.forEach((t) => expect(t).toBeGreaterThanOrEqual(64))
    expect(travel[2]).toBeGreaterThan(travel[1])
    expect(travel[1]).toBeGreaterThan(travel[0])
  })

  it.each(CASES)('moves every reel the same way, apart from the settle (%j to %j)', (from, to) => {
    const all = frames(from, to)
    for (let r = 0; r < 3; r++) {
      let back = 0
      for (let i = 1; i < all.length; i++) back += Math.max(0, all[i - 1][r] - all[i][r])
      expect(back).toBeLessThan(0.34)
    }
  })

  it.each(CASES)('never jumps (%j to %j)', (from, to) => {
    const all = frames(from, to)
    for (let i = 1; i < all.length; i++)
      for (let r = 0; r < 3; r++) expect(Math.abs(all[i][r] - all[i - 1][r])).toBeLessThanOrEqual(2)
  })

  it.each(CASES)('overshoots by less than a third of a symbol (%j to %j)', (from, to) => {
    const all = frames(from, to)
    const end = all[all.length - 1]
    for (let r = 0; r < 3; r++) {
      const most = Math.max(...all.map((f) => f[r] - end[r]))
      expect(most).toBeGreaterThan(0.05)
      expect(most).toBeLessThan(1 / 3)
    }
  })

  it.each(CASES)('does not speed up again once a reel has started slowing (%j to %j)', (from, to) => {
    const all = frames(from, to)
    for (let r = 0; r < 3; r++) {
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
