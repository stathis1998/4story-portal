import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }
const main = () => screen.getByRole('navigation', { name: 'Main' })

describe('header menu', () => {
  it('keeps six entries, with the rest grouped under Rankings and Tools', async () => {
    mockApi()
    renderRoute('/characters', { me })

    await screen.findByRole('navigation', { name: 'Main' })
    expect(within(main()).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Characters',
      'Online',
      'Achievements',
      'Shop',
    ])
    expect(within(main()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Rankings', 'Tools'])
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
