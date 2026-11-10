import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { gearItem } from '../../test/gear'
import { CharacterGear } from './CharacterGear'

// The links are plain anchors here, so the gear renders without a router.
describe('CharacterGear', () => {
  it('puts the cloak under the head on the left and the necklace at the top on the right', () => {
    render(<CharacterGear gear={[]} caption="Kaelith" />)
    const [left, , right] = screen.getByRole('group', { name: 'Equipped gear' }).querySelector('.grid')!.children
    const names = (column: Element) => [...column.querySelectorAll('[role=img]')].map((slot) => slot.getAttribute('aria-label'))

    expect(names(left)).toEqual(['Head, empty', 'Back, empty', 'Body, empty', 'Hands, empty', 'Pants, empty', 'Feet, empty'])
    expect(names(right)).toEqual(['Neck, empty', 'Left earring, empty', 'Right earring, empty', 'Left ring, empty', 'Right ring, empty', 'Face, empty'])
  })

  it('links each equipped weapon and armour piece to its 3D view with its level, effect and skin', () => {
    render(
      <CharacterGear
        gear={[
          gearItem({ slot: 0, itemId: 7625, name: 'Sword of Dawn', upgrade: 23, gradeEffect: 7, moggItemId: 9001 }),
          gearItem({ slot: 2, slotName: 'Long weapon', itemId: 701, name: 'Small bow', upgrade: 3 }),
          gearItem({ slot: 5, slotName: 'Body', itemId: 3000, name: 'Plate', upgrade: 20, gradeEffect: 33 }),
          gearItem({ slot: 4, slotName: 'Back', itemId: 1602, name: "Warlord's Cloak", upgrade: 24 }),
        ]}
        caption="Kaelith"
      />,
    )

    expect(screen.getByRole('link', { name: 'View Sword of Dawn in 3D' })).toHaveAttribute(
      'href',
      '/effects?item=7625&level=23&effect=7&skin=9001',
    )
    expect(screen.getByRole('link', { name: 'View Small bow in 3D' })).toHaveAttribute('href', '/effects?item=701&level=3&effect=1')
    expect(screen.getByRole('link', { name: 'View Plate in 3D' })).toHaveAttribute('href', '/effects?item=3000&level=20&effect=33')
    // Cloaks draw their effect another way, which the preview doesn't cover.
    expect(screen.queryByRole('link', { name: /Cloak/ })).not.toBeInTheDocument()
  })
})
