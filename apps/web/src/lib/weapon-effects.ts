import type { GradeOp, UvKey, WeaponEffectsData, WeaponSearchResult } from '@4story-portal/shared'
import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from './api'

export const weaponEffectsQueryOptions = queryOptions({
  queryKey: ['weapon-effects'],
  queryFn: () => apiFetch<WeaponEffectsData>('/weapon-effects'),
  staleTime: Infinity,
})

export const weaponSearchQueryOptions = (q: string, kind: number | undefined) =>
  queryOptions({
    queryKey: ['weapon-effects', 'weapons', q, kind ?? 'all'],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (kind !== undefined) params.set('kind', String(kind))
      return apiFetch<WeaponSearchResult[]>(`/weapon-effects/weapons?${params}`)
    },
    staleTime: Infinity,
  })

export const weaponModelUrl = (itemId: number, skinId: number | null) =>
  `/api/weapon-models/${itemId}.glb${skinId ? `?skin=${skinId}` : ''}`

export const gradeTextureUrl = (texture: number) => `/api/weapon-effects/textures/${texture}.png`

const IDENTITY: UvKey = { tick: 0, u: 0, v: 0, rotation: 0, scaleU: 1, scaleV: 1 }

/**
 * The UV key at `timeMs`, as TEXTURESET::GetUV in the client's T3D.h works it out: the clock runs
 * modulo the loop, and values move linearly from one key to the next.
 */
export function uvAt(keys: UvKey[], loopMs: number, timeMs: number): UvKey {
  if (keys.length === 0) return IDENTITY
  const tick = loopMs > 0 ? timeMs % loopMs : 0
  let result = keys[0]
  for (let i = 0; i < keys.length - 1; i++) {
    const from = keys[i]
    const to = keys[i + 1]
    if (tick < from.tick) break
    if (tick < to.tick) {
      const t = (tick - from.tick) / (to.tick - from.tick)
      const mix = (a: number, b: number) => a + (b - a) * t
      return {
        tick,
        u: mix(from.u, to.u),
        v: mix(from.v, to.v),
        rotation: mix(from.rotation, to.rotation),
        scaleU: mix(from.scaleU, to.scaleU),
        scaleV: mix(from.scaleV, to.scaleV),
      }
    }
    result = to
  }
  return result
}

/**
 * CTMath::GetUVMatrix as a column-major 3x3 for three.js: move the middle of the texture to the
 * origin, rotate, scale, move back, then offset. D3D applies it to row vectors, which is the same
 * as this matrix times the column (u, v, 1).
 */
export function uvMatrix({ u, v, rotation, scaleU, scaleV }: UvKey): number[] {
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  return [
    scaleU * c,
    -scaleV * s,
    0,
    scaleU * s,
    scaleV * c,
    0,
    -0.5 * scaleU * (c + s) + 0.5 + u,
    0.5 * scaleV * (s - c) + 0.5 + v,
    1,
  ]
}

/** The client's D3DTEXTUREOP for stage 1 as GLSL, mixing the lit weapon `base` with the effect texture `g`. */
export function blendGlsl(op: GradeOp): string {
  switch (op) {
    case 1:
      return 'clamp(base * g, 0.0, 1.0)'
    case 2:
      return 'clamp(2.0 * base * g, 0.0, 1.0)'
    case 3:
      return 'clamp(4.0 * base * g, 0.0, 1.0)'
    case 4:
      return 'clamp(base + g, 0.0, 1.0)'
    case 5:
      return 'clamp(base + g - 0.5, 0.0, 1.0)'
    case 6:
      return 'clamp(2.0 * (base + g - 0.5), 0.0, 1.0)'
    case 19:
      return 'clamp(base + base * g, 0.0, 1.0)'
  }
}

export const GRADE_OPS: readonly GradeOp[] = [1, 2, 3, 4, 5, 6, 19]
