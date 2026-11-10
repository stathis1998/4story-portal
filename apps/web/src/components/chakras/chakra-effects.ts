// A rough copy of the game's chakra effects, for previewing them. The emitters come from the client's effect
// records (Tcd\TSFX.tcd -> SFX\CharSFX.TFX): where they spray, how often, how big and how they fade. How the
// particles move is made up, and the game's 3D strand and orb meshes are drawn as simple shapes.
// Sprites are textures 285967502/504/508/509 from Skin\0_CharSFX.TTX, saved in public/chakra-sprites.

export type Vec3 = readonly [number, number, number]
export type Shape = 'streak' | 'orb' | 'ring'

/** One particle stream. Positions are game units around the character's middle, y up. */
export type Emitter = {
  /** A sprite texture, or a shape standing in for one of the game's effect meshes. */
  look: { sprite: number } | { shape: Shape; color: string }
  /** Half the size of the box particles start in. With `sphere`, the radius they start at instead. */
  spread: Vec3
  sphere?: boolean
  every: number
  count: number
  size: number
  /** Opacity over the particle's one-second life: [ms, 0-1] pairs. */
  fade: readonly (readonly [number, number])[]
}

export type ChakraEffect = 'basic' | 'enhanced' | 'fire' | 'enhancedFire' | 'violet'

export const PARTICLE_LIFE = 1000

const PULSE = [[0, 0], [500, 1], [1000, 0]] as const

// Two sprite streams make up the plain effects: a wide cloud and a tall column.
const cloud = (sprite: number): Emitter => ({ look: { sprite }, spread: [1.1, 0.75, 1.1], every: 50, count: 1, size: 0.7, fade: PULSE })
const column = (sprite: number, fade: Emitter['fade']): Emitter => ({ look: { sprite }, spread: [0.5, 1.4, 0.5], every: 50, count: 1, size: 1, fade })

// The enhanced effects add rising strands, orbs on a sphere around the body, and pulses from the middle.
const extras = (strand: string, orb: string, core: string): Emitter[] => [
  { look: { shape: 'streak', color: strand }, spread: [0.04, 0.35, 0.04], every: 100, count: 1, size: 1, fade: [[0, 0], [500, 0.78], [1000, 0]] },
  { look: { shape: 'orb', color: orb }, spread: [1, 1, 1], sphere: true, every: 500, count: 5, size: 0.35, fade: PULSE },
  { look: { shape: 'ring', color: core }, spread: [0, 0, 0], every: 500, count: 2, size: 1, fade: PULSE },
]

const BASIC = 285967508
const FIRE = 285967509

export const EFFECTS: Record<ChakraEffect, readonly Emitter[]> = {
  basic: [cloud(BASIC), column(BASIC, [[0, 0], [266, 1], [766, 0.59], [1000, 0]])],
  fire: [cloud(FIRE), column(FIRE, [[0, 0], [500, 1], [766, 0.71], [1000, 0]])],
  enhanced: [...extras('#1988ff', '#011cff', '#0f2dff'), cloud(BASIC), column(BASIC, [[0, 0], [266, 1], [766, 0.59], [1000, 0]])],
  enhancedFire: [...extras('#ff6e05', '#ff310c', '#ff3709'), cloud(FIRE), column(FIRE, [[0, 0], [500, 1], [766, 0.71], [1000, 0]])],
  violet: [
    { look: { sprite: 285967504 }, spread: [0.5, 0.5, 0.5], every: 100, count: 1, size: 1.3, fade: PULSE },
    { look: { sprite: 285967502 }, spread: [0.41, 0.41, 0.41], every: 100, count: 1, size: 0.8, fade: [[0, 0], [166, 0.78], [500, 1], [1000, 0]] },
    { look: { shape: 'streak', color: '#ff37ff' }, spread: [0.8, 0.8, 0.8], every: 100, count: 3, size: 0.6, fade: [[0, 0], [166, 1], [533, 1], [1000, 0]] },
  ],
}

export const SPRITES = [...new Set(Object.values(EFFECTS).flatMap((emitters) => emitters.flatMap((e) => ('sprite' in e.look ? [e.look.sprite] : []))))]

/** Opacity `ms` into a particle's life, straight lines between the keys. */
export function fadeAt(fade: Emitter['fade'], ms: number): number {
  if (ms <= fade[0][0]) return fade[0][1]
  for (let i = 1; i < fade.length; i++) {
    const [t1, a1] = fade[i]
    if (ms <= t1) {
      const [t0, a0] = fade[i - 1]
      return a0 + ((a1 - a0) * (ms - t0)) / (t1 - t0)
    }
  }
  return fade[fade.length - 1][1]
}

/**
 * The game recolours a tinted chakra by adding the tint to each pixel and taking away half (Direct3D's
 * ADDSIGNED). Works in place on RGBA pixels and leaves alpha alone.
 */
export function addSigned(pixels: Uint8ClampedArray, tint: string): void {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16) - 128)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] += r
    pixels[i + 1] += g
    pixels[i + 2] += b
  }
}

export type Particle = { emitter: Emitter; born: number; x: number; y: number; z: number; spin: number }

/** A new particle somewhere in the emitter's box or on its sphere. `random` returns 0 to 1. */
export function spawn(emitter: Emitter, born: number, random: () => number): Particle {
  const between = (half: number) => (random() * 2 - 1) * half
  const [sx, sy, sz] = emitter.spread
  if (emitter.sphere) {
    const angle = random() * Math.PI * 2
    const height = random() * 2 - 1
    const across = Math.sqrt(1 - height * height)
    return { emitter, born, x: Math.cos(angle) * across * sx, y: height * sy, z: Math.sin(angle) * across * sz, spin: random() * Math.PI * 2 }
  }
  return { emitter, born, x: between(sx), y: between(sy), z: between(sz), spin: random() * Math.PI * 2 }
}
