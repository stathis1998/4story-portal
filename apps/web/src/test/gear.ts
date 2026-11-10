import type { GearItem, ItemTooltip } from '@4story-portal/shared'

export const tooltip = (overrides: Partial<ItemTooltip> = {}): ItemTooltip => ({
  title: { text: 'Sword', color: '#F9E9CA' },
  competence: null,
  quality: 'normal',
  lines: [],
  ...overrides,
})

export const gearItem = (overrides: Partial<GearItem> = {}): GearItem => ({
  slot: 0,
  slotName: 'Main weapon',
  itemId: 7625,
  name: 'Sword',
  icon: 12,
  upgrade: 0,
  gradeEffect: 0,
  moggItemId: 0,
  tooltip: tooltip(),
  ...overrides,
})
