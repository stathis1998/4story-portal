import type { OnlineCharacter } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

const players: OnlineCharacter[] = [
  { id: 3, name: 'Kaelith', level: 50, className: 'Warrior', channel: 1 },
  { id: 7, name: 'Moosey', level: 90, className: 'Wizard', channel: 2 },
]

const route = (body: OnlineCharacter[] = players) => ({ 'GET /online': () => json(200, body) })

describe('online page', () => {
  it('is linked from the header', async () => {
    mockApi(route())
    const { user, router } = renderRoute('/characters', { me })

    await user.click(await screen.findByRole('link', { name: 'Online' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/online'))
    expect(await screen.findByRole('heading', { name: 'Online', level: 1 })).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/online', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('counts and lists the characters in the game, linking each to its inspect page', async () => {
    mockApi(route())
    renderRoute('/online', { me })

    expect(await screen.findByText('2 characters online')).toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['Kaelith', 'Warrior', '50', '1'],
      ['Moosey', 'Wizard', '90', '2'],
    ])
    expect(within(rows[1]).getByRole('link', { name: 'Moosey' })).toHaveAttribute('href', '/inspect/7')
  })

  it('says so when nobody is online', async () => {
    mockApi(route([]))
    renderRoute('/online', { me })

    expect(await screen.findByText('Nobody is in the game right now.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('offers a retry when the list fails to load', async () => {
    let calls = 0
    mockApi({ 'GET /online': () => (++calls === 1 ? json(500, { message: 'boom' }) : json(200, players.slice(0, 1))) })
    const { user } = renderRoute('/online', { me })

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('1 character online')).toBeInTheDocument()
  })
})
