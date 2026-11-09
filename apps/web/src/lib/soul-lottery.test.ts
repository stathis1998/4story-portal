import { describe, expect, it } from 'vitest'
import { formatCopper, rollSoulLottery } from './soul-lottery'

/** Feeds `rollSoulLottery` the exact values the game's rand() would return. */
const rands = (...values: number[]) => {
  let next = 0
  return () => (values[next++] + 0.5) / 32768
}

describe('rollSoulLottery', () => {
  it('pays the prize when the drawn number is one of the four', () => {
    const roll = rollSoulLottery(60, rands(4, 9, 14, 19, 0, 1000, 9))

    expect(roll).toEqual({ numbers: [5, 10, 15, 20], drawn: 10, won: true, prize: 75_405_822, copper: 75_405_822 })
  })

  it('pays level x 1,000 copper when the drawn number is not one of the four', () => {
    const roll = rollSoulLottery(60, rands(4, 9, 14, 19, 0, 1000, 0))

    expect(roll).toMatchObject({ drawn: 1, won: false, prize: 75_405_822, copper: 60_000 })
  })

  it('draws again until all four numbers are different', () => {
    const roll = rollSoulLottery(60, rands(4, 4, 9, 9, 4, 14, 14, 9, 4, 19, 0, 0, 0))

    expect(roll.numbers).toEqual([5, 10, 15, 20])
  })

  it('limits the prize spread to the multiplier times the level base', () => {
    const roll = rollSoulLottery(1, rands(4, 9, 14, 19, 49, 1000, 9))

    expect(roll.prize).toBe(138)
  })

  it('cannot add more than the largest rand() value at high levels', () => {
    const roll = rollSoulLottery(90, rands(4, 9, 14, 19, 99, 32767, 9))

    expect(roll.prize).toBe((32767 + 1_140_823) * 138)
  })
})

describe('formatCopper', () => {
  it.each([
    [75_405_822, '75g 405s 822c'],
    [60_000, '60s'],
    [1_000_005, '1g 5c'],
    [0, '0c'],
  ])('shows %i copper as %s', (copper, text) => {
    expect(formatCopper(copper)).toBe(text)
  })
})
