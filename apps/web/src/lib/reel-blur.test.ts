import type { SlotStops } from '@4story-portal/shared'
import { describe, expect, it } from 'vitest'
import { blurStep, blurStepsAt, REEL_BLURS } from './reel-blur'
import { planReels, reelTimes, reelsAt } from './slots'

const FRAME = 1 / 60
const NONE = [false, false, false, false, false]
const CASES: [SlotStops, SlotStops, number[]][] = [
  [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], reelTimes(NONE, false)],
  [[3, 30, 11, 0, 17], [5, 0, 20, 31, 2], reelTimes(NONE, false)],
  [[31, 31, 31, 31, 31], [0, 1, 2, 3, 4], reelTimes(NONE, true)],
  [[7, 12, 25, 1, 9], [6, 31, 24, 0, 8], reelTimes([true, true, false, false, false], false)],
]
const STRONGEST = REEL_BLURS.length

/** Each reel's blur step on every frame of a spin at 60 frames a second, and a little past the end. */
const steps = (from: SlotStops, to: SlotStops, times: number[]) => {
  const plan = planReels(from, to, times)
  return Array.from({ length: Math.round((Math.max(...times) + 0.5) / FRAME) + 1 }, (_, i) => blurStepsAt(plan, i * FRAME))
}

describe('the reels blur', () => {
  it('blurs only along the reel, a little more at each step', () => {
    expect(REEL_BLURS.map((blur) => blur.id)).toEqual(['slot-reel-blur-1', 'slot-reel-blur-2', 'slot-reel-blur-3'])
    for (let i = 1; i < REEL_BLURS.length; i++) {
      expect(REEL_BLURS[i].from).toBeGreaterThan(REEL_BLURS[i - 1].from)
      expect(REEL_BLURS[i].deviation).toBeGreaterThan(REEL_BLURS[i - 1].deviation)
    }
    // At full speed the smear is on the order of a symbol's height (48 to 64 px).
    expect(REEL_BLURS[STRONGEST - 1].deviation).toBeGreaterThanOrEqual(24)
  })

  it('is off at rest and on slow movement, and strongest at full speed', () => {
    expect(blurStep(0)).toBe(0)
    expect(blurStep(3)).toBe(0)
    expect(blurStep(5)).toBe(1)
    expect(blurStep(20)).toBe(2)
    expect(blurStep(115)).toBe(STRONGEST)
    // The settle runs backwards for a moment: it is the speed that counts, not the way.
    expect(blurStep(-50)).toBe(STRONGEST)
  })

  it.each(CASES)('gives every reel the strongest blur at full speed and none at rest (%j to %j at %j)', (from, to, times) => {
    const plan = planReels(from, to, times)
    const all = steps(from, to, times)
    const end = Math.max(...times)
    for (let r = 0; r < 5; r++) expect(Math.max(...all.map((frame) => frame[r]))).toBe(STRONGEST)
    expect(blurStepsAt(plan, 0)).toEqual([0, 0, 0, 0, 0])
    expect(blurStepsAt(plan, end)).toEqual([0, 0, 0, 0, 0])
    expect(blurStepsAt(plan, end + 2)).toEqual([0, 0, 0, 0, 0])
  })

  it.each(CASES)('never blurs a reel more while it slows (%j to %j at %j)', (from, to, times) => {
    const plan = planReels(from, to, times)
    const all = steps(from, to, times)
    for (let r = 0; r < 5; r++) {
      // From the frame where the reel is fastest on, the blur only ever steps down.
      const speeds = all.map((_, i) => Math.abs(reelsAt(plan, i * FRAME)[r] - reelsAt(plan, (i - 1) * FRAME)[r]))
      const fastest = speeds.indexOf(Math.max(...speeds))
      for (let i = fastest + 1; i < all.length; i++) expect(all[i][r]).toBeLessThanOrEqual(all[i - 1][r])
    }
  })
})
