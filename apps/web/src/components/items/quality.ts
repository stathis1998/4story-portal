import type { ItemQuality, ItemTooltip } from '@4story-portal/shared'

const BORDERS: Partial<Record<ItemQuality, string>> = { magic: '#44A9FF', rare: '#FFB12A', wrap: '#FF6464' }

/** The icon border the game gives this quality. A graded item takes its title's tint. */
export const qualityBorder = (tooltip: ItemTooltip) =>
  tooltip.quality === 'grade' ? tooltip.title.color : BORDERS[tooltip.quality]
