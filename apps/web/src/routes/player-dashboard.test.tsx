import type { ActiveEvents, BadgeView, CharacterProfile, HallOfFame, PlayerOverview } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { character } from '../test/characters'
import { gearItem } from '../test/gear'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { clickNav } from '../test/nav'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }
const gm = { userId: 2, username: 'moose', isGm: true }

const badge = (overrides: Partial<BadgeView> = {}): BadgeView => ({
  id: 'level-50',
  name: 'Level 50',
  description: 'Reach level 50',
  category: 'progress',
  comingSoon: false,
  earned: true,
  holders: 2,
  players: 5,
  firstSeen: null,
  isNew: false,
  firstToEarn: false,
  ...overrides,
})

const overview = (overrides: Partial<PlayerOverview> = {}): PlayerOverview => ({
  today: '2026-11-01',
  hoursPlayed: 35.5,
  daysPlayed: 12,
  currentStreak: 3,
  longestStreak: 7,
  activity: [
    { date: '2026-10-30', minutes: 45 },
    { date: '2026-10-31', minutes: 200 },
  ],
  badges: [badge()],
  characters: [{ id: 1, progress: 0.25, hoursPlayed: 30 }],
  ...overrides,
})

const noEvents: ActiveEvents = { serverNow: '2026-11-01T16:30', events: [] }

const base = (extra: Parameters<typeof mockApi>[0] = {}) => ({
  'GET /characters': () => json(200, [character({ id: 1, name: 'Kaelith' })]),
  'GET /me/overview': () => json(200, overview()),
  'GET /events/active': () => json(200, noEvents),
  ...extra,
})

describe('characters page stats', () => {
  it('sums up the account', async () => {
    mockApi(base())
    renderRoute('/characters', { me })

    const summary = within(await screen.findByRole('region', { name: 'Your journey' }))
    expect(summary.getByText('35.5')).toBeInTheDocument()
    expect(summary.getByText('Hours played')).toBeInTheDocument()
    expect(summary.getByText('12')).toBeInTheDocument()
    expect(summary.getByText('3')).toBeInTheDocument()
    expect(summary.getByText(/session is saved/)).toBeInTheDocument()
  })

  it('draws a calendar, labelling each day with the server date and time played', async () => {
    mockApi(base())
    renderRoute('/characters', { me })

    expect(await screen.findByRole('img', { name: '2026-10-31: 3h 20m' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2026-10-30: 45m' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2026-11-01: not played' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^2026-11-02/ })).not.toBeInTheDocument()
  })

  it('shows badges with rarity, new and first to earn, earned ones first', async () => {
    mockApi(
      base({
        'GET /me/overview': () =>
          json(
            200,
            overview({
              badges: [
                badge({ id: 'level-90', name: 'Level 90', earned: false, holders: 1 }),
                badge({ id: 'level-50', firstSeen: '2026-10-30', isNew: true, firstToEarn: true }),
              ],
            }),
          ),
      }),
    )
    renderRoute('/characters', { me })

    const list = within(await screen.findByRole('list', { name: 'Achievements' }))
    const items = list.getAllByRole('listitem')
    expect(within(items[0]).getByText('Level 50')).toBeInTheDocument()
    expect(within(items[0]).getByText('New')).toBeInTheDocument()
    expect(within(items[0]).getByText('First to earn')).toBeInTheDocument()
    expect(within(items[0]).getByText('Held by 2 of 5 players')).toBeInTheDocument()
    expect(within(items[0]).getByText('Earned 30 Oct')).toBeInTheDocument()
    expect(within(items[1]).getByText('Level 90')).toBeInTheDocument()
    expect(within(items[1]).getByText('Not earned yet')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 earned')).toBeInTheDocument()
  })

  describe('achievement categories', () => {
    const categorised = () =>
      overview({
        badges: [
          badge({ id: 'level-50', name: 'Level 50', category: 'progress' }),
          badge({ id: 'level-90', name: 'Level 90', category: 'progress', earned: false }),
          badge({ id: 'hours-10', name: '10 Hours', category: 'playtime', earned: false }),
          badge({ id: 'quests-10', name: 'Helping Hand', category: 'progress', comingSoon: true, earned: false, holders: 0 }),
          badge({ id: 'deaths-1', name: 'Ouch', description: 'Die for the first time', category: 'misfortune', comingSoon: true, earned: false, holders: 0 }),
        ],
      })
    const show = async () => {
      mockApi(base({ 'GET /me/overview': () => json(200, categorised()) }))
      renderRoute('/characters', { me })
      await screen.findByRole('tablist')
    }

    it('has a tab per category with its count, leaving out coming soon ones', async () => {
      await show()
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Progress 1/2', 'Playtime 0/1', 'Misfortune'])
      expect(screen.getByText('1 of 3 earned')).toBeInTheDocument()
    })

    it('shows one category at a time', async () => {
      await show()
      expect(screen.getByText('Level 50')).toBeInTheDocument()
      expect(screen.queryByText('10 Hours')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('tab', { name: 'Playtime 0/1' }))
      expect(screen.getByText('10 Hours')).toBeInTheDocument()
      expect(screen.queryByText('Level 50')).not.toBeInTheDocument()
      expect(screen.getByRole('tabpanel', { name: 'Playtime 0/1' })).toBeInTheDocument()
    })

    it('marks coming soon ones, after the rest and without rarity', async () => {
      await show()
      const items = within(screen.getByRole('list', { name: 'Achievements' })).getAllByRole('listitem')
      expect(items.map((item) => within(item).getAllByText(/Level|Helping/)[0].textContent)).toEqual(['Level 50', 'Level 90', 'Helping Hand'])
      expect(within(items[2]).getByText('Coming soon')).toBeInTheDocument()
      expect(within(items[2]).queryByText(/Held by/)).not.toBeInTheDocument()
      expect(within(items[2]).queryByText('Not earned yet')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('tab', { name: 'Misfortune' }))
      expect(screen.getByText('Ouch')).toBeInTheDocument()
      expect(screen.getByText('Die for the first time')).toBeInTheDocument()
      expect(screen.getByText('Coming soon')).toBeInTheDocument()
    })
  })

  it('adds progress and hours to the card, and links to the character', async () => {
    mockApi(base())
    renderRoute('/characters', { me })

    expect(await screen.findByRole('progressbar', { name: 'Progress to next level' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('30 h played')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Kaelith' })).toHaveAttribute('href', '/characters/1')
  })

  it('has no progress bar without a level chart row', async () => {
    mockApi(base({ 'GET /me/overview': () => json(200, overview({ characters: [{ id: 1, progress: null, hoursPlayed: 0 }] })) }))
    renderRoute('/characters', { me })

    await screen.findByText('0 h played')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('keeps showing the characters when the stats fail', async () => {
    mockApi(base({ 'GET /me/overview': () => json(500, { statusCode: 500, message: 'Internal server error' }) }))
    renderRoute('/characters', { me })

    expect(await screen.findByRole('heading', { name: 'Kaelith' })).toBeInTheDocument()
    expect(await screen.findByText('Your stats could not be loaded right now.')).toBeInTheDocument()
  })

  it('welcomes a player with no characters instead of showing empty stats', async () => {
    mockApi(
      base({
        'GET /characters': () => json(200, []),
        'GET /me/overview': () =>
          json(200, overview({ hoursPlayed: 0, daysPlayed: 0, currentStreak: 0, longestStreak: 0, activity: [], characters: [], badges: [badge({ earned: false })] })),
      }),
    )
    renderRoute('/characters', { me })

    expect(await screen.findByText('No characters yet. Create one in the game.')).toBeInTheDocument()
    expect(await screen.findByText('0 of 1 earned')).toBeInTheDocument()
  })

  describe('event banner', () => {
    const banner = () => screen.findByRole('complementary', { name: 'Active events' })
    const active = (events: ActiveEvents['events'], serverNow = '2026-11-01T16:30') => ({
      'GET /events/active': () => json(200, { serverNow, events }),
    })
    const exp = { type: 1, typeName: 'EXP', bonus: 100, mapName: null, endsAt: '2026-11-01T18:45' }

    it('shows a running event and when it ends', async () => {
      mockApi(base(active([exp])))
      renderRoute('/characters', { me })

      expect(await banner()).toHaveTextContent('EXP +100%, ends in 2h 15m')
    })

    it('adds the map of a drop event on one map', async () => {
      mockApi(base(active([{ ...exp, type: 3, typeName: 'Item drop', bonus: 50, mapName: 'Sand Wind' }])))
      renderRoute('/characters', { me })

      expect(await banner()).toHaveTextContent('Item drop +50% in Sand Wind, ends in 2h 15m')
    })

    it('counts days for a long event', async () => {
      mockApi(base(active([{ ...exp, endsAt: '2026-11-04T16:30' }])))
      renderRoute('/characters', { me })

      expect(await banner()).toHaveTextContent('ends in 3d')
    })

    it('says soon for the last minute', async () => {
      mockApi(base(active([{ ...exp, endsAt: '2026-11-01T16:30' }])))
      renderRoute('/characters', { me })

      expect(await banner()).toHaveTextContent('ends soon')
    })

    it('shows nothing with no events, or when the call fails', async () => {
      mockApi(base({ 'GET /events/active': () => json(500, { statusCode: 500, message: 'x' }) }))
      renderRoute('/characters', { me })

      await screen.findByRole('heading', { name: 'Kaelith' })
      expect(screen.queryByRole('complementary', { name: 'Active events' })).not.toBeInTheDocument()
    })
  })
})

describe('character page', () => {
  const profile = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 1,
    name: 'Kaelith',
    level: 50,
    className: 'Warrior',
    race: 'Human',
    country: 'Defugel',
    progress: 0.5,
    ageDays: 304,
    hoursPlayed: 30,
    daysPlayed: 12,
    longestStreak: 7,
    longestSessionMinutes: 150,
    gear: [
      gearItem({ upgrade: 24 }),
      gearItem({ slot: 3, slotName: 'Head', itemId: 2, name: 'Item #2', icon: null }),
    ],
    companions: [{ slot: 0, name: 'Rex', level: 20 }],
    titles: ['Warlord'],
    titlesTotal: 110,
    ranked: true,
    rankings: [{ category: 'level', label: 'Highest level', place: 2, display: 'Lv. 50' }],
    ...overrides,
  })

  const route = (body: unknown, status = 200) => ({ 'GET /characters/1/profile': () => json(status, body) })

  it('shows the character and its records', async () => {
    mockApi(route(profile()))
    renderRoute('/characters/1', { me })

    expect(await screen.findByRole('heading', { name: 'Kaelith' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progress to next level' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText('2h 30m')).toBeInTheDocument()
    expect(screen.getByText('304 days')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your characters' })).toHaveAttribute('href', '/characters')
  })

  it('shows gear in its slots, with its icon', async () => {
    mockApi(route(profile()))
    renderRoute('/characters/1', { me })

    const gear = within(await screen.findByRole('group', { name: 'Equipped gear' }))
    expect(gear.getByRole('button', { name: 'Main weapon: Sword' }).querySelector('img')).toHaveAttribute('src', '/game-icons/12.png')
    expect(gear.getByRole('button', { name: 'Head: Item #2' })).toBeInTheDocument()
    expect(gear.getByRole('img', { name: 'Back, empty' })).toBeInTheDocument()
  })

  it('shows companions, titles out of the total, and rankings', async () => {
    mockApi(route(profile()))
    renderRoute('/characters/1', { me })

    expect(await screen.findByText('Rex')).toBeInTheDocument()
    expect(screen.getByText('Lv. 20')).toBeInTheDocument()
    expect(screen.getByText('1 of 110 collected')).toBeInTheDocument()
    expect(screen.getByText('Warlord')).toBeInTheDocument()
    expect(screen.getByText('2nd')).toBeInTheDocument()
    expect(screen.getByText('Highest level')).toBeInTheDocument()
  })

  it('has friendly empty states for a new character', async () => {
    mockApi(
      route(
        profile({ gear: [], companions: [], titles: [], rankings: [], progress: null, ageDays: null, hoursPlayed: 0, longestSessionMinutes: 0 }),
      ),
    )
    renderRoute('/characters/1', { me })

    expect(await screen.findByRole('img', { name: 'Main weapon, empty' })).toBeInTheDocument()
    expect(screen.getByText('No companions yet.')).toBeInTheDocument()
    expect(screen.getByText('0 of 110 collected')).toBeInTheDocument()
    expect(screen.getByText('Not ranked in anything yet.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says a hidden GM is not ranked', async () => {
    mockApi(route(profile({ ranked: false, rankings: [] })))
    renderRoute('/characters/1', { me: gm })

    expect(await screen.findByText('GM, not ranked.')).toBeInTheDocument()
  })

  it.each([404, 400])('says not found on a %i, with a way back', async (status) => {
    mockApi(route({ statusCode: status, message: 'Character not found' }, status))
    renderRoute('/characters/1', { me })

    expect(await screen.findByText('That character was not found on your account.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your characters' })).toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    let calls = 0
    mockApi({
      'GET /characters/1/profile': () =>
        ++calls === 1 ? json(500, { statusCode: 500, message: 'x' }) : json(200, profile({ name: 'Recovered' })),
    })
    const { user } = renderRoute('/characters/1', { me })

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Recovered' })).toBeInTheDocument()
  })
})

describe('hall of fame', () => {
  const hall = (overrides: Partial<HallOfFame> = {}): HallOfFame => ({
    ranked: true,
    gm: null,
    categories: [
      {
        id: 'level',
        label: 'Highest level',
        entries: [
          { characterId: 3, place: 1, name: 'Moosey', className: 'Wizard', level: 93, display: 'Lv. 93', detail: null, mine: false },
          { characterId: 1, place: 2, name: 'Kaelith', className: 'Warrior', level: 50, display: 'Lv. 50', detail: null, mine: true },
        ],
        you: null,
      },
      {
        id: 'item',
        label: 'Best item',
        entries: [{ characterId: 3, place: 1, name: 'Moosey', className: 'Wizard', level: 93, display: '+24', detail: 'Sword', mine: false }],
        you: { place: 4, name: 'Kaelith', display: '+3' },
      },
      { id: 'titles', label: 'Most titles', entries: [], you: null },
    ],
    ...overrides,
  })

  const route = (body: HallOfFame = hall()) => ({ 'GET /hall-of-fame': () => json(200, body) })

  it('is linked from the header', async () => {
    mockApi(base(route()))
    const { user, router } = renderRoute('/characters', { me })

    await clickNav(user, 'Rankings', 'Hall of Fame')

    await waitFor(() => expect(router.state.location.pathname).toBe('/hall-of-fame'))
    expect(await screen.findByRole('heading', { name: 'Hall of Fame', level: 1 })).toBeInTheDocument()
  })

  it('marks the current page in the header', async () => {
    mockApi(route())
    const { user } = renderRoute('/hall-of-fame', { me })

    const group = await screen.findByRole('button', { name: 'Rankings' })
    expect(group).toHaveClass('text-fg')
    await user.click(group)
    const current = screen.getByRole('link', { name: 'Hall of Fame' })
    expect(current).not.toHaveClass('text-muted')
    expect(current).toHaveClass('text-fg')
    expect(screen.getByRole('link', { name: 'Characters' })).toHaveClass('text-muted')
  })

  it('lists each category with places, marking your entry', async () => {
    mockApi(route())
    renderRoute('/hall-of-fame', { me })

    const level = within(await screen.findByRole('region', { name: 'Highest level' }))
    const rows = level.getAllByRole('listitem')
    expect(within(rows[0]).getByText('1st')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Moosey')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Wizard, level 93')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Lv. 93')).toBeInTheDocument()
    expect(within(rows[0]).queryByText('You')).not.toBeInTheDocument()
    expect(within(rows[1]).getByText('You')).toBeInTheDocument()
  })

  it('shows the item behind a best item entry, and your place below the list', async () => {
    mockApi(route())
    renderRoute('/hall-of-fame', { me })

    const item = within(await screen.findByRole('region', { name: 'Best item' }))
    expect(item.getByText('Sword')).toBeInTheDocument()
    expect(item.getByText('You: 4th, Kaelith, +3')).toBeInTheDocument()
  })

  it('says when nobody has made a category yet', async () => {
    mockApi(route())
    renderRoute('/hall-of-fame', { me })

    expect(within(await screen.findByRole('region', { name: 'Most titles' })).getByText('Nobody yet.')).toBeInTheDocument()
  })

  it('does not offer the switch to players', async () => {
    mockApi(route())
    renderRoute('/hall-of-fame', { me })

    await screen.findByRole('region', { name: 'Highest level' })
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('lets a GM hide GM accounts, then refreshes the page', async () => {
    let hidden = false
    const fetchMock = mockApi({
      'GET /hall-of-fame': () => json(200, hall({ ranked: !hidden, gm: { hideGms: hidden } })),
      'PUT /gm/hall-of-fame/settings': (body) => {
        hidden = (body as { hideGms: boolean }).hideGms
        return json(200, { hideGms: hidden })
      },
    })
    const { user } = renderRoute('/hall-of-fame', { me: gm })

    const toggle = await screen.findByRole('switch', { name: 'Hide GM accounts' })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/hall-of-fame/settings')).toEqual([{ hideGms: true }]))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Hide GM accounts' })).toBeChecked())
    expect(await screen.findByText('GM, not ranked.')).toBeInTheDocument()
  })

  it('shows why the switch failed and leaves it as it was', async () => {
    mockApi({
      'GET /hall-of-fame': () => json(200, hall({ gm: { hideGms: false } })),
      'PUT /gm/hall-of-fame/settings': () => json(503, { statusCode: 503, message: 'Settings could not be saved' }),
    })
    const { user } = renderRoute('/hall-of-fame', { me: gm })

    await user.click(await screen.findByRole('switch', { name: 'Hide GM accounts' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be saved')
    expect(screen.getByRole('switch', { name: 'Hide GM accounts' })).not.toBeChecked()
  })

  it('offers a retry when loading fails', async () => {
    let calls = 0
    mockApi({
      'GET /hall-of-fame': () => (++calls === 1 ? json(500, { statusCode: 500, message: 'x' }) : json(200, hall())),
    })
    const { user } = renderRoute('/hall-of-fame', { me })

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('region', { name: 'Highest level' })).toBeInTheDocument()
  })
})
