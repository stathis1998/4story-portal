import { describe, expect, it } from 'vitest'
import { MAX_LEVEL } from './upgrade-simulator'
import { fillStrategy, loadStrategy, saveStrategy } from './upgrade-strategy'

const KEY = 'upgrade-simulator.strategy'
const rows = fillStrategy({ scroll: 'master', potion: 100, tincture: 'greater' })

describe('fillStrategy', () => {
  it('gives every level below +24 the same choices', () => {
    expect(rows).toHaveLength(MAX_LEVEL)
    expect(rows[23]).toEqual({ scroll: 'master', potion: 100, tincture: 'greater' })
  })

  it("uses an Apprentice's Formula at +0 instead of a Scroll of Reflection", () => {
    const filled = fillStrategy({ scroll: 'reflection', potion: 0, tincture: 'none' })

    expect(filled[0].scroll).toBe('apprentice')
    expect(filled[1].scroll).toBe('reflection')
  })
})

describe('saved strategy', () => {
  it('is empty until one is saved', () => {
    expect(loadStrategy()).toBeNull()
  })

  it('comes back as it was saved', () => {
    saveStrategy({ perLevel: true, rows })

    expect(loadStrategy()).toEqual({ perLevel: true, rows })
  })

  it.each([
    ['text that is not JSON', 'nope'],
    ['too few levels', JSON.stringify({ perLevel: true, rows: rows.slice(1) })],
    ['an unknown scroll', JSON.stringify({ perLevel: true, rows: rows.map((row) => ({ ...row, scroll: 'legendary' })) })],
    ['an unknown Serendipity', JSON.stringify({ perLevel: true, rows: rows.map((row) => ({ ...row, potion: 250 })) })],
    ['a Scroll of Reflection at +0', JSON.stringify({ perLevel: true, rows: rows.map((row) => ({ ...row, scroll: 'reflection' })) })],
  ])('ignores %s', (_, stored) => {
    localStorage.setItem(KEY, stored)

    expect(loadStrategy()).toBeNull()
  })
})
