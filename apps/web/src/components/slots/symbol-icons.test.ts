import { SLOT_MACHINES } from '@4story-portal/shared'
import { expect, it } from 'vitest'

it('has an icon file for every symbol of every machine', () => {
  // Only the file names: nothing is loaded.
  const files = new Set(Object.keys(import.meta.glob('../../../public/game-icons/*.png')).map((file) => file.split('/').pop()))

  const missing = SLOT_MACHINES.flatMap((machine) => machine.symbols.map((symbol) => `${symbol.sprite}.png`)).filter((file) => !files.has(file))
  expect(files.size).toBeGreaterThan(0)
  expect(missing).toEqual([])
})
