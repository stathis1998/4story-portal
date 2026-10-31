import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { character } from '../test/characters'
import { CharacterCard } from './CharacterCard'

describe('CharacterCard', () => {
  it('shows the character details', () => {
    render(<CharacterCard character={character()} />)

    expect(screen.getByRole('heading', { name: 'Moosey' })).toBeInTheDocument()
    for (const text of ['Lv. 45', 'Wizard', 'Human', 'Defugel', '1,234', '56', '78', 'Map 12', '30 Oct 2026']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it('shows a dash for a missing last logout and the unknown class label', () => {
    render(<CharacterCard character={character({ createdAt: null, lastLogoutAt: null, className: 'Unknown (9)' })} />)

    expect(screen.getByText('Unknown (9)')).toBeInTheDocument()
    expect(screen.getByTestId('last-logout')).toHaveTextContent('—')
  })
})
