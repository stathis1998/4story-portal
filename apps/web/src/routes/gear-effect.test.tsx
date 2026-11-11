import type { CharacterProfile, GearEffect } from '@4story-portal/shared'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }
const PUT = 'PUT /characters/1/gear-effect'

const profile: CharacterProfile = {
  id: 1,
  name: 'Kaelith',
  level: 40,
  className: 'Wizard',
  race: 'Human',
  country: 'Defugel',
  progress: null,
  ageDays: null,
  hoursPlayed: 0,
  daysPlayed: 0,
  longestStreak: 0,
  longestSessionMinutes: 0,
  gear: [],
  companions: [],
  titles: [],
  titlesTotal: 110,
  ranked: true,
  rankings: [],
}

const items = [
  { slot: 0, itemId: 3001, name: 'Dragon Helm', upgrade: 17, effect: 3 },
  { slot: 6, itemId: 1001, name: 'Dragon Sword', upgrade: 24, effect: 0 },
]

function setup(gear: Partial<GearEffect>, put?: (body: unknown) => Response) {
  const state: GearEffect = { online: false, items, ...gear }
  const fetchMock = mockApi({
    'GET /characters/1/profile': () => json(200, profile),
    'GET /characters/1/gear-effect': () => json(200, state),
    [PUT]: put ?? ((body) => json(200, { ...state, items: state.items.map((item) => ({ ...item, effect: (body as { effect: number }).effect })) })),
  })
  return { fetchMock, ...renderRoute('/characters/1', { me }) }
}

const listed = () => screen.findByRole('list', { name: 'Items that take the effect' })

describe('gear effect section', () => {
  it('applies the picked effect to every listed item', async () => {
    const { fetchMock, user } = setup({})

    expect(within(await listed()).getByText('Dragon Sword')).toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: 'Effects' })).getAllByRole('button')[11])
    await user.click(screen.getByRole('button', { name: /^Apply .* to 2 items$/ }))

    expect(await screen.findByText(/^Done\./)).toBeInTheDocument()
    expect(sentBodies(fetchMock, PUT)).toEqual([{ effect: 12 }])
    expect(within(await listed()).queryByText('No effect')).not.toBeInTheDocument()
  })

  it('links to a preview of the picked effect on a worn item', async () => {
    setup({})

    const link = await screen.findByRole('link', { name: 'Preview on Dragon Helm' })
    expect(link.getAttribute('href')).toContain('item=3001')
    expect(link.getAttribute('href')).toContain('level=17')
  })

  it('asks to log out while the character is online', async () => {
    setup({ online: true })

    expect(await screen.findByText(/Log out of the game with this character to change this/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument()
  })

  it('says when nothing worn can carry an effect', async () => {
    setup({ items: [] })

    expect(await screen.findByText(/Nothing this character wears is \+17 or higher/)).toBeInTheDocument()
  })

  it('shows the server message when the change is refused', async () => {
    const { user } = setup({}, () => json(409, { statusCode: 409, message: 'Log out of the game with this character first' }))

    await listed()
    await user.click(screen.getByRole('button', { name: /^Apply/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Log out of the game with this character first')
  })
})
