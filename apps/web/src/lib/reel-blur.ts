import { reelsAt } from './slots'
import type { ReelPlan } from './slots'

/**
 * The blurs a moving reel is drawn with, weakest first. Each smears the strip along its run only (an SVG Gaussian
 * blur of `deviation` px up and down, none sideways) and starts at `from` stops a second. At full speed a reel runs
 * past one or two symbols a frame, which drawn sharp would strobe; the strongest blur smears it over about a symbol.
 * A few fixed steps, so a reel's filter changes a handful of times a spin rather than every frame.
 */
export const REEL_BLURS = [
  { id: 'slot-reel-blur-1', from: 4, deviation: 4 },
  { id: 'slot-reel-blur-2', from: 12, deviation: 12 },
  { id: 'slot-reel-blur-3', from: 30, deviation: 28 },
] as const

/** Which blur a reel moving at `speed` stops a second gets: 0 for none, otherwise 1 to 3, an index into REEL_BLURS plus one. */
export function blurStep(speed: number): number {
  const fast = Math.abs(speed)
  let step = 0
  REEL_BLURS.forEach((blur, i) => {
    if (fast > blur.from) step = i + 1
  })
  return step
}

const FRAME = 1 / 60

/** Each reel's blur step `seconds` into a spin, from how far it moved over the frame before. */
export function blurStepsAt(plan: ReelPlan, seconds: number): number[] {
  const now = reelsAt(plan, seconds)
  const before = reelsAt(plan, seconds - FRAME)
  return now.map((position, i) => blurStep((position - before[i]) / FRAME))
}
