import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CharacterGear } from './CharacterGear'

describe('CharacterGear', () => {
  it('puts the cloak under the head on the left and the necklace at the top on the right', () => {
    render(<CharacterGear gear={[]} caption="Kaelith" />)
    const [left, , right] = screen.getByRole('group', { name: 'Equipped gear' }).querySelector('.grid')!.children
    const names = (column: Element) => [...column.querySelectorAll('[role=img]')].map((slot) => slot.getAttribute('aria-label'))

    expect(names(left)).toEqual(['Head, empty', 'Back, empty', 'Body, empty', 'Hands, empty', 'Pants, empty', 'Feet, empty'])
    expect(names(right)).toEqual(['Neck, empty', 'Left earring, empty', 'Right earring, empty', 'Left ring, empty', 'Right ring, empty', 'Face, empty'])
  })
})
