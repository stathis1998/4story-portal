import { describe, expect, it } from 'vitest'
import { attemptsOf, failuresOf, fillLevels, luckText, niceTicks, percent } from './upgrade-stats'

const level = (n: number, success = 1) => ({ level: n, success, saved: 0, lostLevels: 0, destroyed: 0, expectedRate: 0.5 })

describe('upgrade stats helpers', () => {
  it('picks round ticks that reach the largest value', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(3)).toEqual([0, 1, 2, 3])
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(154)).toEqual([0, 50, 100, 150, 200])
    expect(niceTicks(1000)).toEqual([0, 500, 1000])
    expect(niceTicks(23_248)).toEqual([0, 10_000, 20_000, 30_000])
  })

  it('fills the gaps between levels with empty ones', () => {
    expect(fillLevels([])).toEqual([])
    const filled = fillLevels([level(2), level(5, 3)])
    expect(filled.map((l) => [l.level, l.success])).toEqual([
      [2, 1],
      [3, 0],
      [4, 0],
      [5, 3],
    ])
  })

  it('adds up attempts and failures', () => {
    const outcomes = { success: 5, saved: 1, lostLevels: 2, destroyed: 3 }
    expect(failuresOf(outcomes)).toBe(6)
    expect(attemptsOf(outcomes)).toBe(11)
  })

  it('rounds percentages and copes with nothing', () => {
    expect(percent(1, 3)).toBe('33%')
    expect(percent(0, 0)).toBe('0%')
  })

  it('says how luck compares with the odds', () => {
    expect(luckText(5, 3.4)).toBe('1.6 more than the odds predicted')
    expect(luckText(1, 3)).toBe('2 fewer than the odds predicted')
    expect(luckText(2, 2.02)).toBe('exactly what the odds predicted')
  })
})
