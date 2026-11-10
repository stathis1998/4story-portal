// A copy of the game's item chart (TITEMCHART: mounts are bType 12 bKind 23, chakras bType 17 bKind 250) as of 2026-11-09.
// Icons are the sprites in game-icons.generated.ts. Mounts that differ only by rental time are one entry here.
// model is the file in public/mount-models: the item's use value, which the client looks up in TMount.tcd.
// effect and tint are what the client plays for each chakra item: the item's use value picks the effect, and
// CTClientObjBase::ApplyCharacterSFX sets the tint by item id.
import type { ChakraEffect } from '../components/chakras/chakra-effects'

export type Item = { name: string; icon: number | null }
export type Chakra = Item & { effect: ChakraEffect; tint: string | null }
export type Mount = Item & { model: number | null; durations: readonly string[] }

export const CHAKRAS: readonly Chakra[] = [
  { name: 'Blue Chakra', icon: 7689, effect: 'basic', tint: null },
  { name: 'Enhanced Blue Chakra', icon: 7689, effect: 'enhanced', tint: null },
  { name: 'Enhanced Fire Chakra', icon: 7689, effect: 'enhancedFire', tint: null },
  { name: 'Enhanced Pink Chakra', icon: 7689, effect: 'enhanced', tint: '#6e1e91' },
  { name: 'Fire Chakra', icon: 7689, effect: 'fire', tint: null },
  { name: 'Green Chakra', icon: 7689, effect: 'basic', tint: '#1aff1a' },
  { name: 'Neon Blue Chakra', icon: 7689, effect: 'basic', tint: '#0b2a6b' },
  { name: 'Neon Violet Chakra', icon: 7689, effect: 'basic', tint: '#ae22ab' },
  { name: 'Red Chakra', icon: 7689, effect: 'basic', tint: '#ff1a1a' },
  { name: 'Violet Chakra', icon: 5896, effect: 'violet', tint: null },
]

export const MOUNTS: readonly Mount[] = [
  { name: 'Albino Tarantula', icon: 10496, model: 21, durations: ['Permanent', '30 days'] },
  { name: 'Behemoth', icon: 9888, model: 16, durations: ['Permanent', '7 days'] },
  { name: 'Behemoth Scroll', icon: 9888, model: 17, durations: ['Permanent'] },
  { name: 'Bell of Darkness', icon: 9871, model: 10, durations: ['1 hour'] },
  { name: 'Black Buffalo', icon: 9894, model: 8, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Black Caribou', icon: 9897, model: 9, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Black Horse', icon: 9891, model: 7, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Black Panda', icon: null, model: 50, durations: ['Permanent'] },
  { name: 'Brown Horse', icon: 9889, model: 1, durations: ['Permanent'] },
  { name: 'Buffalo', icon: 9892, model: 2, durations: ['Permanent'] },
  { name: 'Caribou', icon: 9895, model: 6, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Fast Caribou', icon: 9870, model: 11, durations: ['1 day', '7 days', '14 days', '30 days'] },
  { name: 'Forest Tarantula', icon: 10495, model: 20, durations: ['Permanent', '30 days'] },
  { name: 'Gift of the Gods - Rudolf', icon: 9870, model: 11, durations: ['3 days'] },
  { name: 'Gorilla', icon: 12287, model: 38, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Grey Horse', icon: 9889, model: 17, durations: ['7 days'] },
  { name: 'Hopping Cow', icon: 11572, model: 23, durations: ['Permanent', '30 days'] },
  { name: 'Hopping Heart Cow', icon: 12348, model: 43, durations: ['Permanent'] },
  { name: 'Hopping Horse', icon: 11571, model: 22, durations: ['Permanent', '30 days'] },
  { name: 'Infuriated Behemoth', icon: 10034, model: 24, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Miracle Broom', icon: 12415, model: 45, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Obsidian Dragon', icon: 12367, model: 40, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Pendatron\'s Shadow', icon: 9871, model: 10, durations: ['Permanent', '7 days'] },
  { name: 'Ratha Panda', icon: 10036, model: 14, durations: ['Permanent', '30 days'] },
  { name: 'Rudolph', icon: 9870, model: 11, durations: ['3 days', '30 days'] },
  { name: 'Rudolph Scroll', icon: 8523, model: 11, durations: ['1 hour'] },
  { name: 'Sapphire Dragon', icon: 12366, model: 42, durations: ['Permanent', '30 days'] },
  { name: 'Silver Bells', icon: 8854, model: 11, durations: ['1 hour'] },
  { name: 'Snow Kitsune', icon: 12368, model: 44, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Snowmobile', icon: 12453, model: 30, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Tarantula', icon: 10496, model: 21, durations: ['Permanent'] },
  { name: 'Tiger Tarantula', icon: 10494, model: 19, durations: ['Permanent', '30 days'] },
  { name: 'White Buffalo', icon: 9893, model: 5, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'White Caribou', icon: 9896, model: 15, durations: ['Permanent', '7 days'] },
  { name: 'White Horse', icon: 9890, model: 4, durations: ['Permanent', '7 days', '30 days', '90 days'] },
  { name: 'White Majestic Horse', icon: 9871, model: 13, durations: ['Permanent', '7 days', '30 days'] },
  { name: 'Wooden Rudolph', icon: 9890, model: 18, durations: ['Permanent', '30 days'] },
]
