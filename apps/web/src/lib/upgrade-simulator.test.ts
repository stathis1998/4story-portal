import { describe, expect, it } from 'vitest'
import { attemptGem, attemptUpgrade, gemChance, upgradeChance, type UpgradeChoices } from './upgrade-simulator'

/** Hands out these game rand() values in order. */
const rolls = (...values: number[]) => {
  let next = 0
  return () => (values[next++] + 0.5) / 32768
}

const choices = (over: Partial<UpgradeChoices> = {}): UpgradeChoices => ({ scroll: 'apprentice', potion: 0, tincture: 'none', ...over })
const FAIL = 99

describe('upgradeChance', () => {
  it('uses the chart by current level', () => {
    expect(upgradeChance(0, 0)).toBe(100)
    expect(upgradeChance(10, 0)).toBe(45)
    expect(upgradeChance(23, 0)).toBe(3)
  })

  it('adds a share of the base chance for Serendipity', () => {
    expect(upgradeChance(20, 300)).toBe(4)
    expect(upgradeChance(14, 100)).toBe(18)
  })

  it('rounds the Serendipity share down, as the server does', () => {
    expect(upgradeChance(20, 150)).toBe(2)
  })

  it('never goes above 100', () => {
    expect(upgradeChance(10, 300)).toBe(100)
  })

  it('is 0 at the top level', () => {
    expect(upgradeChance(24, 300)).toBe(0)
  })
})

describe('attemptUpgrade', () => {
  it('succeeds when the roll is under the chance', () => {
    expect(attemptUpgrade(10, choices(), rolls(44))).toEqual({ outcome: 'success', level: 11, tinctureUsed: false })
  })

  it('fails when the roll equals the chance', () => {
    expect(attemptUpgrade(10, choices(), rolls(45)).outcome).toBe('destroyed')
  })

  it("adds 1 to 3 levels with a Master's Formula", () => {
    expect(attemptUpgrade(10, choices({ scroll: 'master' }), rolls(0, 0)).level).toBe(11)
    expect(attemptUpgrade(10, choices({ scroll: 'master' }), rolls(0, 2)).level).toBe(13)
  })

  it('stops at +24', () => {
    expect(attemptUpgrade(23, choices({ scroll: 'master' }), rolls(0, 2)).level).toBe(24)
  })

  it('leaves a successful attempt without using a tincture', () => {
    expect(attemptUpgrade(10, choices({ tincture: 'survival' }), rolls(0)).tinctureUsed).toBe(false)
  })

  it('destroys the item with no tincture', () => {
    expect(attemptUpgrade(12, choices(), rolls(FAIL))).toEqual({ outcome: 'destroyed', level: 12, tinctureUsed: false })
  })

  describe('Survival Tincture', () => {
    const tincture = choices({ tincture: 'survival' })

    it('keeps the level at or below +11, and is used up', () => {
      expect(attemptUpgrade(9, tincture, rolls(FAIL))).toEqual({ outcome: 'kept', level: 9, tinctureUsed: true })
      expect(attemptUpgrade(11, tincture, rolls(FAIL))).toEqual({ outcome: 'kept', level: 11, tinctureUsed: true })
    })

    it.each([
      [19, 14, 'kept'],
      [20, 13, 'downgraded'],
      [54, 13, 'downgraded'],
      [55, 12, 'downgraded'],
    ])('on a down roll of %i leaves +14 at +%i', (down, level, outcome) => {
      expect(attemptUpgrade(14, tincture, rolls(FAIL, down))).toEqual({ outcome, level, tinctureUsed: true })
    })

    it('never drops below +11', () => {
      expect(attemptUpgrade(12, tincture, rolls(FAIL, 99))).toEqual({ outcome: 'downgraded', level: 11, tinctureUsed: true })
    })
  })

  describe.each([
    ['medium', 15],
    ['greater', 19],
  ] as const)('%s tincture', (tincture, floor) => {
    it('keeps the item below its level, without being used up', () => {
      expect(attemptUpgrade(floor - 1, choices({ tincture }), rolls(FAIL))).toEqual({ outcome: 'kept', level: floor - 1, tinctureUsed: false })
    })

    it('keeps the level exactly at its floor, and is used up', () => {
      expect(attemptUpgrade(floor, choices({ tincture }), rolls(FAIL))).toEqual({ outcome: 'kept', level: floor, tinctureUsed: true })
    })

    it('never drops below its floor', () => {
      expect(attemptUpgrade(floor + 1, choices({ tincture }), rolls(FAIL, 99))).toEqual({ outcome: 'downgraded', level: floor, tinctureUsed: true })
    })

    it('can drop two levels above its floor', () => {
      expect(attemptUpgrade(floor + 3, choices({ tincture }), rolls(FAIL, 99)).level).toBe(floor + 1)
    })
  })
})

describe('gemChance', () => {
  it('doubles the chart for a Flawless Gemstone', () => {
    expect(gemChance(0, 'flawless')).toBe(66)
  })

  it('uses the chart as it is for a plain Gemstone', () => {
    expect(gemChance(1, 'plain')).toBe(20)
  })

  it('quadruples it for a Cash Gemstone, up to 100', () => {
    expect(gemChance(3, 'cash')).toBe(32)
    expect(gemChance(0, 'cash')).toBe(100)
  })

  it('cannot take a plain Gemstone from 2 gems to 3', () => {
    expect(gemChance(2, 'plain')).toBe(0)
  })

  it('always works for a Green Gemstone', () => {
    expect(gemChance(4, 'green')).toBe(100)
  })

  it('is 0 at 5 gems', () => {
    expect(gemChance(5, 'green')).toBe(0)
  })
})

describe('attemptGem', () => {
  it('adds a gem when the roll is within the chance', () => {
    // The server rolls 1 to 100, so rand() 65 is a roll of 66.
    expect(attemptGem(0, 'flawless', rolls(65))).toEqual({ success: true, gem: 1 })
  })

  it('fails on the roll just past the chance', () => {
    expect(attemptGem(0, 'flawless', rolls(66)).success).toBe(false)
  })

  it('resets the gems on a normal failure', () => {
    expect(attemptGem(4, 'flawless', rolls(FAIL))).toEqual({ success: false, gem: 0 })
  })

  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
  ])('with a Perfect Gemstone, a failure at %i gems leaves %i', (gem, left) => {
    expect(attemptGem(gem, 'perfect', rolls(FAIL))).toEqual({ success: false, gem: left })
  })

  it('never succeeds for a plain Gemstone at 2 gems', () => {
    expect(attemptGem(2, 'plain', rolls(0)).success).toBe(false)
  })

  it('always succeeds for a Green Gemstone', () => {
    expect(attemptGem(4, 'green', rolls(FAIL))).toEqual({ success: true, gem: 5 })
  })
})
