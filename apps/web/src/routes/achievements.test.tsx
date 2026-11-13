import type { AchievementsOverview } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { accountGroup, achievement, achievementsOverview, characterGroup, simple } from '../test/achievements'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

const route = (body: AchievementsOverview = achievementsOverview()) => ({ 'GET /me/achievements': () => json(200, body) })

const several = () =>
  achievementsOverview({
    characters: [
      characterGroup({
        achievements: [
          achievement(),
          simple('veteran', 'Veteran', 100, { category: 'combat' }),
          simple('hours', 'Regular', 40, { category: 'playtime' }),
        ],
      }),
    ],
  })

/** Kaelith with Slayer, Mounara with a finished Slayer and a gear one, and an account with one playtime achievement. */
const family = (overrides: Partial<AchievementsOverview> = {}) =>
  achievementsOverview({
    account: accountGroup([simple('founder', 'Founder', 40, { category: 'playtime' })]),
    characters: [
      characterGroup(),
      characterGroup({
        id: 2,
        name: 'Mounara',
        level: 30,
        className: 'Wizard',
        achievements: [simple('slayer', 'Slayer', 100), simple('smith', 'Blacksmith', 20, { category: 'gear' })],
      }),
    ],
    ...overrides,
  })

const cardNames = () =>
  within(screen.getByRole('list', { name: 'Achievements' }))
    .getAllByRole('button')
    .map((card) => /^[A-Z][a-z]+/.exec(card.textContent ?? '')?.[0])

const owners = async () => within(await screen.findByRole('group', { name: 'Whose achievements' }))
const pressed = async () =>
  (await owners())
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent)

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
          characters: [
            characterGroup({
              achievements: [
                simple('a', 'Alpha', 100),
                simple('b', 'Bravo', 90),
                started('c', 'Charlie', 1000),
                started('d', 'Delta', 8000),
                simple('e', 'Echo', 0),
              ],
            }),
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

  describe('whose achievements', () => {
    it('offers each character with its level, class and count, then the account, starting on the first character', async () => {
      mockApi(route(family()))
      const { router } = renderRoute('/achievements', { me })

      expect((await owners()).getAllByRole('button').map((button) => button.textContent)).toEqual([
        'Kaelith Lv. 50 Warrior 2/5',
        'Mounara Lv. 30 Wizard 1/2',
        'Account 0/1',
      ])
      expect(await pressed()).toEqual(['Kaelith Lv. 50 Warrior 2/5'])
      expect(screen.getByText('2 of 5 levels completed')).toBeInTheDocument()
      expect(cardNames()).toEqual(['Slayer'])
      // The default is not written into the address.
      expect(router.state.location.search).toEqual({})
    })

    it('switches to another character, keeping it in the address', async () => {
      mockApi(route(family()))
      const { user, router } = renderRoute('/achievements', { me })

      await user.click((await owners()).getByRole('button', { name: /^Mounara/ }))

      await waitFor(() => expect(router.state.location.search).toEqual({ character: 2 }))
      expect(await pressed()).toEqual(['Mounara Lv. 30 Wizard 1/2'])
      expect(screen.getByText('1 of 2 levels completed')).toBeInTheDocument()
      // Only the categories this character has anything in.
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Combat 1/1', 'Gear 0/1'])
      expect(cardNames()).toEqual(['Slayer'])

      await user.click(screen.getByRole('tab', { name: 'Gear 0/1' }))
      expect(cardNames()).toEqual(['Blacksmith'])
    })

    it('shows the account achievements with a note that they pay nothing, in place of the rewards note', async () => {
      mockApi(route(family({ live: false })))
      const { user, router } = renderRoute('/achievements', { me })

      expect(await screen.findByText(/Rewards are not switched on/)).toBeInTheDocument()
      expect(screen.queryByText(/Account achievements are for the record/)).not.toBeInTheDocument()

      await user.click((await owners()).getByRole('button', { name: /^Account/ }))

      await waitFor(() => expect(router.state.location.search).toEqual({ view: 'account' }))
      expect(await screen.findByText('Account achievements are for the record. They pay no reward.')).toBeInTheDocument()
      expect(screen.queryByText(/Rewards are not switched on/)).not.toBeInTheDocument()
      expect(await pressed()).toEqual(['Account 0/1'])
      expect(screen.getByText('0 of 1 levels completed')).toBeInTheDocument()
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Playtime 0/1'])
      expect(cardNames()).toEqual(['Founder'])

      // And back: the address follows every change.
      await user.click(screen.getByRole('button', { name: /^Kaelith/ }))
      await waitFor(() => expect(router.state.location.search).toEqual({ character: 1 }))
      expect(await pressed()).toEqual(['Kaelith Lv. 50 Warrior 2/5'])
    })

    it('counts an account achievement out of the players, a character one out of the characters', async () => {
      const founder = simple('founder', 'Founder', 100, { category: 'playtime' })
      founder.levels[0] = { ...founder.levels[0], holders: 2, holderNames: ['Aki', 'Bo'] }
      mockApi(
        route(
          family({
            account: accountGroup([founder]),
            characters: [characterGroup({ achievements: [achievement({ population: 15 })] })],
          }),
        ),
      )
      const { user } = renderRoute('/achievements', { me })

      await user.click(await screen.findByRole('button', { name: /^Slayer/ }))
      expect(screen.getByRole('dialog', { name: 'Slayer' })).toHaveTextContent('4 of 15 characters')
      await user.click(screen.getByRole('button', { name: 'Close' }))

      await user.click((await owners()).getByRole('button', { name: /^Account/ }))
      await user.click(await screen.findByRole('button', { name: /^Founder/ }))
      expect(screen.getByRole('dialog', { name: 'Founder' })).toHaveTextContent('Reached by Aki and Bo · 2 of 5 players')
    })

    it('opens on the character in the address', async () => {
      mockApi(route(family()))
      renderRoute('/achievements?character=2', { me })

      expect(await pressed()).toEqual(['Mounara Lv. 30 Wizard 1/2'])
      expect(screen.getByText('1 of 2 levels completed')).toBeInTheDocument()
    })

    it('opens on the account when the address asks for it', async () => {
      mockApi(route(family()))
      renderRoute('/achievements?view=account', { me })

      expect(await pressed()).toEqual(['Account 0/1'])
      expect(screen.getByText('Account achievements are for the record. They pay no reward.')).toBeInTheDocument()
      expect(cardNames()).toEqual(['Founder'])
    })

    it.each(['?character=99', '?character=abc', '?view=everyone'])('falls back to the first character for %s', async (search) => {
      mockApi(route(family()))
      renderRoute(`/achievements${search}`, { me })

      expect(await pressed()).toEqual(['Kaelith Lv. 50 Warrior 2/5'])
      expect(screen.getByText('2 of 5 levels completed')).toBeInTheDocument()
    })

    it('shows the account for an account with no characters', async () => {
      mockApi(route(family({ characters: [] })))
      renderRoute('/achievements', { me })

      expect((await owners()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Account 0/1'])
      expect(await pressed()).toEqual(['Account 0/1'])
      expect(screen.getByText('Account achievements are for the record. They pay no reward.')).toBeInTheDocument()
      expect(cardNames()).toEqual(['Founder'])
    })

    it('says so when the selection has no achievements', async () => {
      mockApi(route())
      renderRoute('/achievements?view=account', { me })

      expect(await screen.findByText('No achievements have been set up yet.')).toBeInTheDocument()
      expect(screen.getByText('0 of 0 levels completed')).toBeInTheDocument()
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    })
  })
})
