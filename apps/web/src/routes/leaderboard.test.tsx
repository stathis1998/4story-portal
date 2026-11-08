import type { HallOfFame, Leaderboard } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }
const gm = { userId: 2, username: 'moose', isGm: true }

const board = (overrides: Partial<Leaderboard> = {}): Leaderboard => ({
  ranked: true,
  categories: [
    {
      id: 'damage',
      label: 'Damage dealt',
      entries: [
        { place: 1, name: 'Moosey', className: 'Wizard', level: 90, display: '5,000,000,000', detail: null, mine: false },
        { place: 2, name: 'Kaelith', className: 'Warrior', level: 50, display: '7,000', detail: null, mine: true },
      ],
      you: null,
    },
    { id: 'kills', label: 'Monsters killed', entries: [], you: null },
  ],
  ...overrides,
})

const route = (body: Leaderboard = board()) => ({ 'GET /leaderboard': () => json(200, body) })

describe('leaderboard page', () => {
  it('is linked from the header', async () => {
    mockApi(route())
    const { user, router } = renderRoute('/characters', { me })

    await user.click(await screen.findByRole('link', { name: 'Leaderboard' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/leaderboard'))
    expect(await screen.findByRole('heading', { name: 'Leaderboard', level: 1 })).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/leaderboard', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('lists a board with places and totals, marking your character', async () => {
    mockApi(route())
    renderRoute('/leaderboard', { me })

    const rows = within(await screen.findByRole('region', { name: 'Damage dealt' })).getAllByRole('listitem')
    expect(within(rows[0]).getByText('1st')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Moosey')).toBeInTheDocument()
    expect(within(rows[0]).getByText('5,000,000,000')).toBeInTheDocument()
    expect(within(rows[0]).queryByText('You')).not.toBeInTheDocument()
    expect(within(rows[1]).getByText('You')).toBeInTheDocument()
  })

  it('says when nobody is on a board yet', async () => {
    mockApi(route())
    renderRoute('/leaderboard', { me })

    expect(within(await screen.findByRole('region', { name: 'Monsters killed' })).getByText('Nobody yet.')).toBeInTheDocument()
  })

  it('tells a hidden GM they are not ranked', async () => {
    mockApi(route(board({ ranked: false })))
    renderRoute('/leaderboard', { me: gm })

    expect(await screen.findByText('GM, not ranked.')).toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    let calls = 0
    mockApi({
      'GET /leaderboard': () => (++calls === 1 ? json(500, { statusCode: 500, message: 'x' }) : json(200, board())),
    })
    const { user } = renderRoute('/leaderboard', { me })

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('region', { name: 'Damage dealt' })).toBeInTheDocument()
  })

  it('goes stale when a GM changes the hide switch', async () => {
    const hall: HallOfFame = { ranked: true, gm: { hideGms: false }, categories: [] }
    mockApi({
      'GET /hall-of-fame': () => json(200, hall),
      'PUT /gm/hall-of-fame/settings': () => json(200, { hideGms: true }),
    })
    const { user, queryClient } = renderRoute('/hall-of-fame', { me: gm })
    queryClient.setQueryData(['leaderboard'], board())

    await user.click(await screen.findByRole('switch', { name: 'Hide GM accounts' }))

    await waitFor(() => expect(queryClient.getQueryState(['leaderboard'])?.isInvalidated).toBe(true))
  })
})
