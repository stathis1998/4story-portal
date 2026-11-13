import type { ActiveEvents, CharacterProfile, HallOfFame, NewsItem, PlayerOverview } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { achievement, achievementsOverview, simple } from '../test/achievements'
import { character } from '../test/characters'
import { gearItem } from '../test/gear'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { clickNav } from '../test/nav'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }
const gm = { userId: 2, username: 'moose', isGm: true }

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
          json(200, overview({ hoursPlayed: 0, daysPlayed: 0, currentStreak: 0, longestStreak: 0, activity: [], characters: [] })),
      }),
    )
    renderRoute('/characters', { me })

    expect(await screen.findByText('No characters yet. Create one in the game.')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Your journey' })).toBeInTheDocument()
  })

  describe('latest news', () => {
    const SERVER_NOW = '2026-11-01T16:30:00'
    const item = (id: number, at: string, overrides: Partial<NewsItem> = {}): NewsItem => ({
      id,
      at,
      text: `Moosey completed Slayer ${id}`,
      mine: false,
      ...overrides,
    })
    const news = (items: NewsItem[]) => ({ 'GET /news': () => json(200, { serverNow: SERVER_NOW, items }) })
    const panel = async () => within(await screen.findByRole('region', { name: 'Latest news' }))

    it('lists the news with how long ago it was, on the server clock', async () => {
      mockApi(
        base(
          news([
            item(4, '2026-11-01T16:29:40'),
            item(3, '2026-11-01T16:25:00'),
            item(2, '2026-11-01T13:10:00'),
            item(1, '2026-10-30T10:00:00'),
          ]),
        ),
      )
      renderRoute('/characters', { me })

      const lines = (await panel()).getAllByRole('listitem')
      expect(lines.map((line) => line.textContent)).toEqual([
        'Moosey completed Slayer 4just now',
        'Moosey completed Slayer 35 min ago',
        'Moosey completed Slayer 23 h ago',
        'Moosey completed Slayer 12 d ago',
      ])
    })

    it('sits above the characters, and marks your own news', async () => {
      mockApi(
        base(
          news([
            item(2, '2026-11-01T16:00:00', { text: 'Kaelith completed Slayer III: Defeat 10,000 monsters', mine: true }),
            item(1, '2026-11-01T15:00:00'),
          ]),
        ),
      )
      renderRoute('/characters', { me })

      const [mine, theirs] = (await panel()).getAllByRole('listitem')
      expect(mine).toHaveTextContent('Kaelith completed Slayer III: Defeat 10,000 monsters')
      expect(mine).toHaveClass('border-accent', 'text-accent-text')
      expect(theirs).not.toHaveClass('border-accent')
      const heading = screen.getByRole('heading', { name: 'Your characters' })
      expect(mine.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('says so when there is none yet', async () => {
      mockApi(base(news([])))
      renderRoute('/characters', { me })

      expect((await panel()).getByText('Nothing yet. Achievement completions will show up here.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument()
    })

    it('shows the newest eight until asked for all', async () => {
      const ten = Array.from({ length: 10 }, (_, index) => item(10 - index, '2026-11-01T12:00:00'))
      mockApi(base(news(ten)))
      const { user } = renderRoute('/characters', { me })

      const list = await panel()
      expect(list.getAllByRole('listitem')).toHaveLength(8)
      expect(list.getByText('Moosey completed Slayer 3')).toBeInTheDocument()
      expect(list.queryByText('Moosey completed Slayer 2')).not.toBeInTheDocument()

      await user.click(list.getByRole('button', { name: 'Show all' }))
      expect(list.getAllByRole('listitem')).toHaveLength(10)
      expect(list.getByText('Moosey completed Slayer 1')).toBeInTheDocument()

      await user.click(list.getByRole('button', { name: 'Show fewer' }))
      expect(list.getAllByRole('listitem')).toHaveLength(8)
    })

    it('has no toggle for eight or fewer', async () => {
      mockApi(base(news(Array.from({ length: 8 }, (_, index) => item(8 - index, '2026-11-01T12:00:00')))))
      renderRoute('/characters', { me })

      expect((await panel()).getAllByRole('listitem')).toHaveLength(8)
      expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument()
    })

    it('shows nothing when the call fails', async () => {
      mockApi(base({ 'GET /news': () => json(500, { statusCode: 500, message: 'x' }) }))
      renderRoute('/characters', { me })

      await screen.findByRole('region', { name: 'Your journey' })
      expect(screen.queryByRole('region', { name: 'Latest news' })).not.toBeInTheDocument()
    })
  })

  describe('almost there', () => {
    const closest = (achievements = [simple('a', 'Alpha', 100), simple('b', 'Bravo', 30), simple('c', 'Charlie', 95), achievement(), simple('e', 'Echo', 0), simple('f', 'Foxtrot', 50)]) => ({
      'GET /me/achievements': () => json(200, achievementsOverview({ achievements })),
    })
    const cards = async () =>
      within(await screen.findByRole('list', { name: 'Almost there' }))
        .getAllByRole('button')
        .map((card) => /^[A-Z][a-z]+/.exec(card.textContent ?? '')?.[0])

    it('shows the three achievements closest to their next level, below the journey', async () => {
      mockApi(base(closest()))
      renderRoute('/characters', { me })

      // Alpha is finished, Slayer is at 74%, Foxtrot at 50%.
      expect(await cards()).toEqual(['Charlie', 'Slayer', 'Foxtrot'])
      const journey = await screen.findByRole('region', { name: 'Your journey' })
      const list = screen.getByRole('list', { name: 'Almost there' })
      expect(journey.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.getByRole('link', { name: 'All achievements' })).toHaveAttribute('href', '/achievements')
    })

    it('shows each one closed, and opens it on a click', async () => {
      mockApi(base(closest([achievement()])))
      const { user } = renderRoute('/characters', { me })

      const card = await screen.findByRole('button', { name: /^Slayer/ })
      expect(card).toHaveAttribute('aria-haspopup', 'dialog')
      expect(card).toHaveTextContent('Next: Defeat 10,000 monsters')

      await user.click(card)
      expect(screen.getByRole('list', { name: 'Slayer levels' })).toBeInTheDocument()
    })

    it('leaves out the ones with nothing counted yet', async () => {
      mockApi(base(closest([simple('e', 'Echo', 0), simple('b', 'Bravo', 30)])))
      renderRoute('/characters', { me })

      expect(await cards()).toEqual(['Bravo'])
    })

    it('shows nothing when everything is finished or untouched', async () => {
      const fetchMock = mockApi(base(closest([simple('a', 'Alpha', 100), simple('e', 'Echo', 0)])))
      renderRoute('/characters', { me })

      await screen.findByRole('region', { name: 'Your journey' })
      await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => input === '/api/me/achievements')).toBe(true))
      expect(screen.queryByRole('heading', { name: 'Almost there' })).not.toBeInTheDocument()
    })

    it('shows nothing when the call fails, and keeps the rest of the page', async () => {
      mockApi(base({ 'GET /me/achievements': () => json(500, { statusCode: 500, message: 'x' }) }))
      renderRoute('/characters', { me })

      expect(await screen.findByRole('region', { name: 'Your journey' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Kaelith' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Almost there' })).not.toBeInTheDocument()
    })
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
