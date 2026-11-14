import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }
const main = () => screen.getByRole('navigation', { name: 'Main' })

describe('header menu', () => {
  it('keeps six entries, with the rest grouped under Try Your Luck, Rankings and Tools', async () => {
    mockApi()
    renderRoute('/characters', { me })

    await screen.findByRole('navigation', { name: 'Main' })
    expect(within(main()).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Characters',
      'Online',
      'Achievements',
    ])
    expect(within(main()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Try Your Luck', 'Rankings', 'Tools'])
  })

  it('opens a group to show its pages, and closes it again', async () => {
    mockApi()
    const { user } = renderRoute('/characters', { me })

    const rankings = await screen.findByRole('button', { name: 'Rankings' })
    expect(rankings).toHaveAttribute('aria-expanded', 'false')
    await user.click(rankings)

    expect(rankings).toHaveAttribute('aria-expanded', 'true')
    const links = within(screen.getByRole('list', { name: 'Rankings' })).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Hall of Fame', 'Leaderboard', 'Upgrade Stats'])

    await user.keyboard('{Escape}')
    expect(rankings).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: 'Rankings' })).not.toBeInTheDocument()
  })

  it('groups the games under Try Your Luck', async () => {
    mockApi()
    const { user } = renderRoute('/characters', { me })

    const luck = await screen.findByRole('button', { name: 'Try Your Luck' })
    expect(luck).toHaveAttribute('aria-controls', 'nav-try-your-luck')
    await user.click(luck)

    const list = screen.getByRole('list', { name: 'Try Your Luck' })
    expect(list).toHaveAttribute('id', 'nav-try-your-luck')
    expect(within(list).getAllByRole('link').map((link) => link.textContent)).toEqual(['Roulette', 'Wheel of Fortune'])
  })

  it('closes a group when you click elsewhere or open the other one', async () => {
    mockApi()
    const { user } = renderRoute('/characters', { me })

    await user.click(await screen.findByRole('button', { name: 'Tools' }))
    expect(within(screen.getByRole('list', { name: 'Tools' })).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Upgrade Simulator',
      'Soul Lottery',
      'Effects',
      'Mounts & Pets',
      'Chakras & Auras',
    ])

    await user.click(screen.getByRole('button', { name: 'Rankings' }))
    expect(screen.queryByRole('list', { name: 'Tools' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByRole('list', { name: 'Rankings' })).not.toBeInTheDocument()
  })

  it('goes to a page and closes the group', async () => {
    mockApi({ 'GET /leaderboard': () => json(200, { ranked: true, categories: [] }) })
    const { user, router } = renderRoute('/characters', { me })

    await user.click(await screen.findByRole('button', { name: 'Rankings' }))
    await user.click(screen.getByRole('link', { name: 'Leaderboard' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/leaderboard'))
    expect(screen.queryByRole('list', { name: 'Rankings' })).not.toBeInTheDocument()
  })

  it('marks the group of the current page', async () => {
    mockApi({ 'GET /leaderboard': () => json(200, { ranked: true, categories: [] }) })
    renderRoute('/leaderboard', { me })

    expect(await screen.findByRole('button', { name: 'Rankings' })).toHaveClass('text-fg')
    expect(screen.getByRole('button', { name: 'Tools' })).toHaveClass('text-muted')
    expect(screen.getByRole('link', { name: 'Characters' })).toHaveClass('text-muted')
  })
})

describe('phone menu', () => {
  const menu = () => screen.getByRole('navigation', { name: 'Menu' })
  const openMenu = async (user: ReturnType<typeof renderRoute>['user']) => {
    const button = await screen.findByRole('button', { name: 'Menu' })
    await user.click(button)
    return button
  }

  it('stays closed until the Menu button is pressed', async () => {
    mockApi()
    renderRoute('/characters', { me })

    expect(await screen.findByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('lists every page, with the grouped ones under Try Your Luck, Rankings and Tools', async () => {
    mockApi()
    const { user } = renderRoute('/characters', { me })

    expect(await openMenu(user)).toHaveAttribute('aria-expanded', 'true')

    expect(within(menu()).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Characters',
      'Online',
      'Achievements',
      'Roulette',
      'Wheel of Fortune',
      'Hall of Fame',
      'Leaderboard',
      'Upgrade Stats',
      'Upgrade Simulator',
      'Soul Lottery',
      'Effects',
      'Mounts & Pets',
      'Chakras & Auras',
    ])
    expect(within(within(menu()).getByRole('list', { name: 'Try Your Luck' })).getAllByRole('link')).toHaveLength(2)
    expect(within(within(menu()).getByRole('list', { name: 'Rankings' })).getAllByRole('link')).toHaveLength(3)
    expect(within(within(menu()).getByRole('list', { name: 'Tools' })).getAllByRole('link')).toHaveLength(5)
  })

  it('goes to a page and closes', async () => {
    mockApi({ 'GET /leaderboard': () => json(200, { ranked: true, categories: [] }) })
    const { user, router } = renderRoute('/characters', { me })

    await openMenu(user)
    await user.click(within(menu()).getByRole('link', { name: 'Leaderboard' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/leaderboard'))
    expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('closes on Escape, and when the Menu button is pressed again', async () => {
    mockApi()
    const { user } = renderRoute('/characters', { me })

    const button = await openMenu(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await user.click(button)
    await user.click(button)
    expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('closes when the page behind it is tapped', async () => {
    mockApi()
    const { user } = renderRoute('/characters', { me })

    await openMenu(user)
    await user.click(screen.getByTestId('menu-backdrop'))

    expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('shows who is signed in and logs out to /login', async () => {
    mockApi({ 'POST /auth/logout': () => new Response(null, { status: 204 }) })
    const { user, router } = renderRoute('/characters', { me })

    await openMenu(user)
    expect(within(menu()).getByText('friend')).toBeInTheDocument()
    await user.click(within(menu()).getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('hides the GM tools from a player', async () => {
    mockApi()
    const { user } = renderRoute('/characters', { me })

    await openMenu(user)
    expect(within(menu()).queryByRole('link', { name: 'GM' })).not.toBeInTheDocument()
  })

  it('offers the GM tools to a GM', async () => {
    mockApi()
    const { user } = renderRoute('/characters', { me: { ...me, isGm: true } })

    await openMenu(user)
    expect(within(menu()).getByRole('link', { name: 'GM' })).toHaveAttribute('href', '/gm/teleport')
  })
})
