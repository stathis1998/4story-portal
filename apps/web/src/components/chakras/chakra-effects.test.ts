import { describe, expect, it } from 'vitest'
import { CHAKRAS } from '../../lib/mounts-chakras'
import { addSigned, EFFECTS, fadeAt, SPRITES, spawn, type Emitter } from './chakra-effects'

const box: Emitter = { look: { sprite: 1 }, spread: [1, 2, 3], every: 50, count: 1, size: 1, fade: [[0, 0], [500, 1], [1000, 0]] }

describe('fadeAt', () => {
  it('runs in straight lines between the keys and holds the ends', () => {
    expect(fadeAt(box.fade, 0)).toBe(0)
    expect(fadeAt(box.fade, 250)).toBe(0.5)
    expect(fadeAt(box.fade, 750)).toBe(0.5)
    expect(fadeAt(box.fade, 2000)).toBe(0)
  })
})

describe('addSigned', () => {
  it('adds the tint less half to each colour and leaves alpha alone', () => {
    const pixels = new Uint8ClampedArray([100, 200, 10, 77])

    addSigned(pixels, '#ff1a80')

    expect([...pixels]).toEqual([227, 98, 10, 77])
  })
})

describe('spawn', () => {
  it('starts a particle inside the box', () => {
    expect(spawn(box, 5, () => 1)).toMatchObject({ born: 5, x: 1, y: 2, z: 3 })
    expect(spawn(box, 5, () => 0)).toMatchObject({ x: -1, y: -2, z: -3 })
  })

  it('starts a sphere particle on the sphere', () => {
    const p = spawn({ ...box, spread: [2, 2, 2], sphere: true }, 0, () => 0.3)

    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(2)
  })
})

describe('chakra effects', () => {
  it('gives every chakra an effect with something to draw', () => {
    for (const chakra of CHAKRAS) expect(EFFECTS[chakra.effect].length).toBeGreaterThan(0)
  })

  it('uses only the sprites saved in public/chakra-sprites', () => {
    expect(SPRITES.sort()).toEqual([285967502, 285967504, 285967508, 285967509])
  })
})
