import { ROULETTE_POCKETS } from '@4story-portal/shared'
import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { ROULETTE_SPIN_SECONDS, frameAt, planSpin, pocketAngle, rouletteErrorMessage } from './roulette'

const norm = (degrees: number) => ((degrees % 360) + 360) % 360
const FRAME = 1 / 60

/** Every frame of a spin at 60 frames a second, and a little past the end. */
const frames = (pocket: number, wheelFrom: number) => {
  const plan = planSpin(pocket, wheelFrom)
  return Array.from({ length: Math.round((ROULETTE_SPIN_SECONDS + 0.5) / FRAME) + 1 }, (_, i) => frameAt(plan, i * FRAME))
}

// A few starts, so the checks do not pass by luck for one wheel position.
const SAMPLES: [number, number][] = [
  [0, 0],
  [17, 123],
  [26, 359.5],
  [5, 4000],
  [32, -90],
]

describe('the roulette wheel', () => {
  it('puts pocket 0 at the top and 32 one step clockwise', () => {
    expect(pocketAngle(0)).toBe(0)
    expect(pocketAngle(32)).toBeCloseTo(360 / 37)
    expect(pocketAngle(26)).toBeCloseTo((36 * 360) / 37)
  })

  it('starts on the track with the wheel where it was', () => {
    const start = frameAt(planSpin(17, 123), 0)
    expect(start.wheel).toBe(123)
    expect(start.depth).toBe(0)
  })

  it.each(ROULETTE_POCKETS)('ends with the ball in pocket %i', (pocket) => {
    const plan = planSpin(pocket, 41)
    const end = frameAt(plan, ROULETTE_SPIN_SECONDS)
    expect(end.depth).toBe(1)
    const off = norm(end.ball - end.wheel - pocketAngle(pocket))
    expect(Math.min(off, 360 - off)).toBeLessThan(0.01)
    expect(frameAt(plan, ROULETTE_SPIN_SECONDS + 5)).toEqual(end)
  })

  it('lands in the right pocket from any start', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      const end = frameAt(planSpin(pocket, wheelFrom), ROULETTE_SPIN_SECONDS)
      const off = norm(end.ball - end.wheel - pocketAngle(pocket))
      expect(Math.min(off, 360 - off)).toBeLessThan(0.01)
    }
  })

  it('turns the wheel one way only', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      const all = frames(pocket, wheelFrom)
      for (let i = 1; i < all.length; i++) expect(all[i].wheel).toBeGreaterThanOrEqual(all[i - 1].wheel)
    }
  })

  it('only slows the wheel down', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      const all = frames(pocket, wheelFrom)
      for (let i = 2; i < all.length; i++) {
        expect(all[i].wheel - all[i - 1].wheel).toBeLessThanOrEqual(all[i - 1].wheel - all[i - 2].wheel + 1e-9)
      }
    }
  })

  it('runs the ball against the wheel while it is on the track', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      const all = frames(pocket, wheelFrom).filter((_, i) => i * FRAME <= 4)
      for (let i = 1; i < all.length; i++) {
        expect(all[i].ball).toBeLessThan(all[i - 1].ball)
        expect(all[i].depth).toBe(0)
      }
    }
  })

  it('slows the ball down all the while it is on the track', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      const all = frames(pocket, wheelFrom).filter((frame) => frame.depth === 0)
      // Still on the track for the first five seconds.
      expect(all.length).toBeGreaterThanOrEqual(5 / FRAME)
      for (let i = 2; i < all.length; i++) {
        const before = all[i - 2].ball - all[i - 1].ball
        const now = all[i - 1].ball - all[i].ball
        expect(now).toBeLessThan(before)
      }
    }
  })

  it('moves inward slowly at first, not at a steady pace', () => {
    const plan = planSpin(17, 123)
    const first = frameAt(plan, 5.25).depth - frameAt(plan, 5).depth
    const later = frameAt(plan, 6).depth - frameAt(plan, 5.75).depth
    expect(first).toBeGreaterThan(0)
    expect(later).toBeGreaterThan(2 * first)
  })

  it('bounces in the pocket before it settles', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      const depths = frames(pocket, wheelFrom).map((frame) => frame.depth)
      const firstIn = depths.findIndex((depth) => depth > 0.999)
      expect(firstIn).toBeGreaterThan(0)
      // It leaves the bottom of the pocket again before it is in for good.
      expect(Math.min(...depths.slice(firstIn))).toBeLessThan(0.9)
      expect(firstIn * FRAME).toBeLessThan(ROULETTE_SPIN_SECONDS - 1)
    }
  })

  it('rides with the wheel once it has settled', () => {
    const plan = planSpin(17, 123)
    for (const seconds of [7.4, 7.6, 7.9]) {
      const frame = frameAt(plan, seconds)
      expect(frame.depth).toBe(1)
      const off = norm(frame.ball - frame.wheel - pocketAngle(17))
      expect(Math.min(off, 360 - off)).toBeLessThan(0.01)
    }
    expect(frameAt(plan, 7.6).wheel).toBeGreaterThan(frameAt(plan, 7.4).wheel)
  })

  it('never jumps', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      const all = frames(pocket, wheelFrom)
      for (let i = 1; i < all.length; i++) {
        expect(Math.abs(all[i].wheel - all[i - 1].wheel)).toBeLessThan(30)
        expect(Math.abs(all[i].ball - all[i - 1].ball)).toBeLessThan(30)
        expect(Math.abs(all[i].depth - all[i - 1].depth)).toBeLessThan(0.2)
      }
    }
  })

  it('turns the wheel at least twice and the ball at least four times', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      const plan = planSpin(pocket, wheelFrom)
      const start = frameAt(plan, 0)
      const end = frameAt(plan, ROULETTE_SPIN_SECONDS)
      expect(end.wheel - start.wheel).toBeGreaterThanOrEqual(2 * 360)
      const lowest = Math.min(...frames(pocket, wheelFrom).map((frame) => frame.ball))
      expect(start.ball - lowest).toBeGreaterThanOrEqual(4 * 360)
    }
  })

  it('keeps the depth between the track and the pocket', () => {
    for (const [pocket, wheelFrom] of SAMPLES) {
      for (const frame of frames(pocket, wheelFrom)) {
        expect(frame.depth).toBeGreaterThanOrEqual(0)
        expect(frame.depth).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('rouletteErrorMessage', () => {
  it('shows a refusal a person can act on, and hides a crash', () => {
    expect(rouletteErrorMessage(new ApiError(409, 'Log the character out of the game first'))).toBe(
      'Log the character out of the game first',
    )
    expect(rouletteErrorMessage(new ApiError(503, 'The table is closed'))).toBe('The table is closed')
    expect(rouletteErrorMessage(new ApiError(500, 'SQL timeout'))).toBe('Something went wrong. Please try again.')
    expect(rouletteErrorMessage(new Error('offline'))).toBe('Something went wrong. Please try again.')
  })
})
