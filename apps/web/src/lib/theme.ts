import { atomWithStorage } from 'jotai/utils'

export type Theme = 'light' | 'dark'

export const themeAtom = atomWithStorage<Theme>('theme', 'dark')
