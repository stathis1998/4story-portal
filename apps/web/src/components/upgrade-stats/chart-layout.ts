import { useLayoutEffect, useRef, useState } from 'react'

/** Space between touching bar segments, in the surface colour. */
export const GAP = 2
const RADIUS = 4
const MAX_BAR = 24
/** Used before the first measurement, and where nothing can be measured (tests). */
const FALLBACK_WIDTH = 720

/**
 * A bar from the baseline at `from` to its end at `to`, either direction. Only the data end is
 * rounded; the baseline end stays square.
 */
export function barPath(x: number, width: number, from: number, to: number, rounded: boolean): string | null {
  const height = Math.abs(to - from)
  if (height < 0.5) return null
  const r = rounded ? Math.min(RADIUS, height, width / 2) : 0
  const dir = to < from ? 1 : -1
  return [
    `M${x},${from}`,
    `V${to + dir * r}`,
    `Q${x},${to} ${x + r},${to}`,
    `H${x + width - r}`,
    `Q${x + width},${to} ${x + width},${to + dir * r}`,
    `V${from}`,
    'Z',
  ].join(' ')
}

/** The width of the element `ref` points at, kept up to date as it resizes. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      if (element.clientWidth > 0) setWidth(element.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

type ColumnOptions = { left: number; right: number; minSlot: number; maxSlot: number; minLabelGap: number }

/**
 * Columns sized to fit `width`, between a minimum and a maximum slot. Below the minimum the chart
 * is wider than its box and scrolls. Bars take 60% of a slot, at most 24px; labels skip columns
 * when they would run into each other.
 */
export function columnLayout(width: number, count: number, { left, right, minSlot, maxSlot, minLabelGap }: ColumnOptions) {
  const usable = width - left - right
  const slot = Math.min(maxSlot, Math.max(minSlot, usable / Math.max(1, count)))
  return {
    slot,
    bar: Math.min(MAX_BAR, Math.max(4, Math.round(slot * 0.6))),
    labelEvery: Math.max(1, Math.ceil(minLabelGap / slot)),
    total: left + count * slot + right,
  }
}

/** Ticks whose labels would overlap the one kept before them are left out. */
export function spacedTicks<T extends { y: number }>(ticks: T[], minGap: number): T[] {
  const kept: T[] = []
  for (const tick of ticks) {
    if (kept.every((other) => Math.abs(other.y - tick.y) >= minGap)) kept.push(tick)
  }
  return kept
}
