import { describe, expect, it } from 'vitest'
import { formatChance, formatCountdown, formatSpinTime, nextRotation, pointAt, segmentAngle, segmentLabel, segmentPath } from './wheel'

describe('formatChance', () => {
  it.each([
    [25, '25%'],
    [12.5, '12.5%'],
    [33.3333, '33.3%'],
    [1, '1%'],
    [0.4, '0.4%'],
    [0.04, '0.04%'],
    [0, '0%'],
  ])('writes %f as %s', (percent, text) => {
    expect(formatChance(percent)).toBe(text)
  })
})

describe('formatCountdown', () => {
  it.each([
    [50_602, '14:03:22'],
    [59, '00:00:59'],
    [0, '00:00:00'],
    [-5, '00:00:00'],
    [86_400, '24:00:00'],
  ])('writes %i seconds as %s', (seconds, text) => {
    expect(formatCountdown(seconds)).toBe(text)
  })
})

describe('formatSpinTime', () => {
  it('shows the day and the time the server had', () => {
    expect(formatSpinTime('2026-11-04T09:05:59.000Z')).toBe('4 Nov, 09:05')
  })
})

describe('the wheel', () => {
  it('puts 0 degrees at the top and goes clockwise', () => {
    const round = (point: number[]) => point.map((value) => Math.round(value))
    expect(round(pointAt(0, 100, 200))).toEqual([200, 100])
    expect(round(pointAt(90, 100, 200))).toEqual([300, 200])
    expect(round(pointAt(180, 100, 200))).toEqual([200, 300])
    expect(round(pointAt(270, 100, 200))).toEqual([100, 200])
  })

  it('draws a quarter wedge from the top to the right', () => {
    expect(segmentPath(0, 4, 100, 200)).toBe('M 200 200 L 200 100 A 100 100 0 0 1 300 200 Z')
  })

  it('uses the large arc when there are only two segments, and a full disc for one', () => {
    expect(segmentPath(0, 2, 100, 200)).toBe('M 200 200 L 200 100 A 100 100 0 0 1 200 300 Z')
    expect(segmentPath(0, 1, 100, 200)).toMatch(/^M 200 100 A 100 100 0 1 1 200 300 A/)
  })

  it('has each segment centred on its middle', () => {
    expect(segmentAngle(0, 4)).toBe(45)
    expect(segmentAngle(3, 4)).toBe(315)
    expect(segmentAngle(0, 1)).toBe(180)
  })

  it('turns at least five times and stops with the segment under the pointer', () => {
    const rotation = nextRotation(0, 1, 4)
    expect(rotation).toBeGreaterThanOrEqual(5 * 360)
    expect(rotation).toBeLessThan(6 * 360)
    // Segment 1 is centred at 135 degrees, so the wheel ends 135 degrees short of a whole turn.
    expect((rotation + 135) % 360).toBe(0)
  })

  it('keeps turning forward from where the last spin stopped', () => {
    const first = nextRotation(0, 2, 10)
    const second = nextRotation(first, 7, 10)
    expect(second - first).toBeGreaterThanOrEqual(5 * 360)
    expect((second + segmentAngle(7, 10)) % 360).toBeCloseTo(0)
  })

  it('shortens a long name to fit the segment', () => {
    expect(segmentLabel('1 Rune')).toBe('1 Rune')
    expect(segmentLabel('10 First-Class Healing Potions')).toBe('10 First-Class Healin…')
    expect(segmentLabel('10 First-Class Healing Potions').length).toBeLessThanOrEqual(22)
  })
})
