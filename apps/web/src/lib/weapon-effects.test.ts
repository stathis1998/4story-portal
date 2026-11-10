import type { UvKey } from '@4story-portal/shared'
import { describe, expect, it } from 'vitest'
import { blendGlsl, uvAt, uvMatrix } from './weapon-effects'

const key = (tick: number, overrides: Partial<UvKey> = {}): UvKey => ({ tick, u: 0, v: 0, rotation: 0, scaleU: 1, scaleV: 1, ...overrides })

/** Applies a column-major 3x3 matrix to (u, v, 1). */
const apply = (m: number[], u: number, v: number) => [m[0] * u + m[3] * v + m[6], m[1] * u + m[4] * v + m[7]]

describe('uvAt', () => {
  const keys = [key(0), key(3000, { v: 1 })]

  it('interpolates between keys and starts over each loop', () => {
    expect(uvAt(keys, 3000, 1500).v).toBeCloseTo(0.5)
    expect(uvAt(keys, 3000, 3000).v).toBe(0)
    expect(uvAt(keys, 3000, 4500).v).toBeCloseTo(0.5)
  })

  it('stands still with no keys or with one key', () => {
    expect(uvAt([], 0, 1234)).toEqual(key(0))
    expect(uvAt([key(0, { u: 0.25 })], 0, 999)).toEqual(key(0, { u: 0.25 }))
  })
})

describe('uvMatrix', () => {
  it('rotates about the middle of the texture like the client', () => {
    const [u, v] = apply(uvMatrix(key(0, { rotation: Math.PI / 2 })), 1, 0.5)
    expect(u).toBeCloseTo(0.5)
    expect(v).toBeCloseTo(0)
  })

  it('moves by the key offset', () => {
    const [u, v] = apply(uvMatrix(key(0, { u: 0.25 })), 0, 0)
    expect(u).toBeCloseTo(0.25)
    expect(v).toBeCloseTo(0)
  })

  it('scales about the middle', () => {
    const [u, v] = apply(uvMatrix(key(0, { scaleU: 2, scaleV: 2 })), 1, 1)
    expect(u).toBeCloseTo(1.5)
    expect(v).toBeCloseTo(1.5)
  })
})

describe('blendGlsl', () => {
  it('writes each Direct3D texture op the client uses', () => {
    expect(blendGlsl(1)).toBe('clamp(base * g, 0.0, 1.0)')
    expect(blendGlsl(4)).toBe('clamp(base + g, 0.0, 1.0)')
    expect(blendGlsl(6)).toBe('clamp(2.0 * (base + g - 0.5), 0.0, 1.0)')
    expect(blendGlsl(19)).toBe('clamp(base + base * g, 0.0, 1.0)')
  })
})
