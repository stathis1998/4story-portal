import type { AchievementsOverview } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { achievement, achievementsOverview, simple } from '../test/achievements'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

const route = (body: AchievementsOverview = achievementsOverview()) => ({ 'GET /me/achievements': () => json(200, body) })

const several = () =>
  achievementsOverview({
    achievements: [
      achievement(),
      simple('veteran', 'Veteran', 100, { category: 'combat' }),
      simple('hours', 'Regular', 40, { category: 'playtime' }),
    ],
  })

const cardNames = () =>
  within(screen.getByRole('list', { name: 'Achievements' }))
    .getAllByRole('button')
    .map((card) => /^[A-Z][a-z]+/.exec(card.textContent ?? '')?.[0])

describe('achievements page', () => {
  it('is linked from the header', async () => {
    mockApi(route())
    const { user, router } = renderRoute('/characters', { me })

    await user.click(await within(await screen.findByRole('navigation', { name: 'Main' })).findByRole('link', { name: 'Achievements' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/achievements'))
    expect(await screen.findByRole('heading', { name: 'Achievements', level: 1 })).toBeInTheDocument()
  })

  it('counts the levels done, overall and on each category tab', async () => {
    mockApi(route(several()))
    renderRoute('/achievements', { me })

    expect(await screen.findByText('3 of 7 levels completed')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Playtime 0/1', 'Combat 3/6'])
  })

  it('shows one category at a time', async () => {
    mockApi(route(several()))
    const { user } = renderRoute('/achievements', { me })

    await screen.findByRole('tablist')
    expect(cardNames()).toEqual(['Regular'])

    await user.click(screen.getByRole('tab', { name: 'Combat 3/6' }))
    expect(cardNames()).toEqual(['Slayer', 'Veteran'])
    expect(screen.getByRole('tabpanel', { name: 'Combat 3/6' })).toBeInTheDocument()
  })

  it('puts the ones in progress first, closest first, then not started, then completed', async () => {
    const started = (id: string, name: string, value: number) =>
      achievement({ id, name, value, valueText: value.toLocaleString('en-US') })
    mockApi(
      route(
        achievementsOverview({
          achievements: [
            simple('a', 'Alpha', 100),
            simple('b', 'Bravo', 90),
            started('c', 'Charlie', 1000),
            started('d', 'Delta', 8000),
            simple('e', 'Echo', 0),
          ],
        }),
      ),
    )
    renderRoute('/achievements', { me })

    await screen.findByRole('tablist')
    // Bravo is nearer its level than Delta, but has no level yet.
    expect(cardNames()).toEqual(['Delta', 'Charlie', 'Bravo', 'Echo', 'Alpha'])
  })

  it('says so while rewards are not switched on', async () => {
    mockApi(route(achievementsOverview({ live: false })))
    renderRoute('/achievements', { me })

    expect(
      await screen.findByText('Rewards are not switched on yet. Your levels are counted and will be paid when they are.'),
    ).toBeInTheDocument()
  })

  it('has no such note once rewards are live', async () => {
    mockApi(route())
    renderRoute('/achievements', { me })

    await screen.findByRole('tablist')
    expect(screen.queryByText(/Rewards are not switched on/)).not.toBeInTheDocument()
  })

  it('opens a card to show its levels', async () => {
    mockApi(route())
    const { user } = renderRoute('/achievements', { me })

    await user.click(await screen.findByRole('button', { name: /^Slayer/ }))

    expect(within(screen.getByRole('list', { name: 'Slayer levels' })).getAllByRole('listitem')).toHaveLength(5)
  })

  it('offers a retry when loading fails', async () => {
    let calls = 0
    mockApi({
      'GET /me/achievements': () =>
        ++calls === 1 ? json(500, { statusCode: 500, message: 'x' }) : json(200, achievementsOverview()),
    })
    const { user } = renderRoute('/achievements', { me })

    expect(await screen.findByText('Could not load your achievements.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('2 of 5 levels completed')).toBeInTheDocument()
  })
})
