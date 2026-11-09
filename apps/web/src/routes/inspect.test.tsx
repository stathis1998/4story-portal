import type { CharacterInspect, CharacterSearchResult, Leaderboard } from '@4story-portal/shared'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { gearItem, tooltip } from '../test/gear'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

const cloak = gearItem({
  slot: 4,
  slotName: 'Back',
  itemId: 1602,
  name: "Warlord's Cloak",
  icon: 9307,
  upgrade: 24,
  tooltip: tooltip({
    title: { text: "Warlord's Cloak (+24)", color: '#F00000' },
    competence: 48,
    quality: 'grade',
    lines: [
      { text: 'Competence Level : 120 +5', color: '#FFFF00' },
      { text: ' ', color: '#F9E9CA' },
      { text: 'Evade +319', color: '#FFB12A' },
    ],
  }),
})

const inspected = (overrides: Partial<CharacterInspect> = {}): CharacterInspect => ({
  id: 2,
  name: 'Rival',
  level: 60,
  className: 'Warrior',
  race: 'Human',
  country: 'Derion',
  gear: [cloak],
  ...overrides,
})

const route = (body: unknown = inspected(), status = 200) => ({ 'GET /characters/2/inspect': () => json(status, body) })

async function openPage() {
  mockApi(route())
  const view = renderRoute('/inspect/2', { me })
  const slot = await screen.findByRole('button', { name: "Back: Warlord's Cloak" })
  return { ...view, slot }
}

describe('inspect page', () => {
  it('shows who the character is', async () => {
    mockApi(route())
    renderRoute('/inspect/2', { me })

    expect(await screen.findByRole('heading', { name: 'Rival', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Level 60 Warrior, Human, Derion')).toBeInTheDocument()
  })

  it('offers a way back to the Leaderboard', async () => {
    mockApi(route())
    renderRoute('/inspect/2', { me })

    expect(await screen.findByRole('link', { name: 'Back to the Leaderboard' })).toHaveAttribute('href', '/leaderboard')
  })

  it('draws filled slots with their icon and empty slots by name', async () => {
    const { slot } = await openPage()

    expect(slot.querySelector('img')).toHaveAttribute('src', '/game-icons/9307.png')
    const gear = screen.getByRole('group', { name: 'Equipped gear' })
    expect(within(gear).getByRole('img', { name: 'Head, empty' })).toBeInTheDocument()
    expect(within(gear).getByRole('img', { name: 'Costume race, empty' })).toBeInTheDocument()
  })

  it('has a place for all 19 equipment slots', async () => {
    await openPage()

    const gear = within(screen.getByRole('group', { name: 'Equipped gear' }))
    expect(gear.getAllByRole('img', { name: /, empty$/ })).toHaveLength(18)
    expect(gear.getAllByRole('button')).toHaveLength(1)
  })

  describe('the tooltip', () => {
    it('stays hidden until you hover', async () => {
      await openPage()
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('opens on hover with the game\'s text and colours, and closes when you leave', async () => {
      const { user, slot } = await openPage()

      await user.hover(slot)
      const panel = within(await screen.findByRole('tooltip'))
      expect(panel.getByText("Warlord's Cloak (+24)")).toHaveStyle({ color: '#F00000' })
      expect(panel.getByText('Competence Level : 120 +5')).toHaveStyle({ color: '#FFFF00' })
      expect(panel.getByText('Evade +319')).toHaveStyle({ color: '#FFB12A' })
      expect(panel.getByText('48')).toBeInTheDocument()

      await user.unhover(slot)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('leaves the competence number off when the item has none', async () => {
      mockApi(route(inspected({ gear: [{ ...cloak, tooltip: { ...cloak.tooltip, competence: null } }] })))
      const { user } = renderRoute('/inspect/2', { me })

      await user.hover(await screen.findByRole('button', { name: "Back: Warlord's Cloak" }))
      expect(within(await screen.findByRole('tooltip')).queryByText('48')).not.toBeInTheDocument()
    })

    it('opens with the keyboard and closes on Escape', async () => {
      const { user, slot } = await openPage()

      slot.focus()
      expect(await screen.findByRole('tooltip')).toBeInTheDocument()
      expect(slot).toHaveAccessibleDescription(/Warlord's Cloak \(\+24\)/)

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('toggles on tap for touch screens', async () => {
      const { slot } = await openPage()

      fireEvent.pointerDown(slot)
      fireEvent.click(slot)
      expect(await screen.findByRole('tooltip')).toBeInTheDocument()

      fireEvent.pointerDown(slot)
      fireEvent.click(slot)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('closes when you tap somewhere else', async () => {
      const { slot } = await openPage()

      fireEvent.pointerDown(slot)
      fireEvent.click(slot)
      await screen.findByRole('tooltip')

      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  it('says when the character cannot be shown', async () => {
    mockApi(route({ statusCode: 404, message: 'Character not found' }, 404))
    renderRoute('/inspect/2', { me })

    expect(await screen.findByText('Character not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the Leaderboard' })).toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    let calls = 0
    mockApi({
      'GET /characters/2/inspect': () => (++calls === 1 ? json(500, { statusCode: 500, message: 'x' }) : json(200, inspected())),
    })
    const { user } = renderRoute('/inspect/2', { me })

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Rival', level: 1 })).toBeInTheDocument()
  })
})

describe('reaching a character', () => {
  const board: Leaderboard = {
    ranked: true,
    categories: [
      {
        id: 'damage',
        label: 'Damage dealt',
        entries: [
          { characterId: 2, place: 1, name: 'Rival', className: 'Warrior', level: 60, display: '9', detail: null, mine: false },
          { characterId: 1, place: 2, name: 'Kaelith', className: 'Wizard', level: 50, display: '7', detail: null, mine: true },
        ],
        you: null,
      },
    ],
  }
  const results: CharacterSearchResult[] = [{ id: 2, name: 'Rival', level: 60, className: 'Warrior' }]
  const withBoard = (extra: Parameters<typeof mockApi>[0] = {}) => mockApi({ 'GET /leaderboard': () => json(200, board), ...extra })
  const SEARCH = 'GET /characters/search?q=riv'

  it('links other players to the inspect page', async () => {
    withBoard()
    renderRoute('/leaderboard', { me })

    expect(await screen.findByRole('link', { name: 'Rival' })).toHaveAttribute('href', '/inspect/2')
  })

  it('links your own characters to your full page', async () => {
    withBoard()
    renderRoute('/leaderboard', { me })

    expect(await screen.findByRole('link', { name: 'Kaelith' })).toHaveAttribute('href', '/characters/1')
  })

  it('finds a character by name', async () => {
    withBoard({ [SEARCH]: () => json(200, results) })
    const { user } = renderRoute('/leaderboard', { me })

    await user.type(await screen.findByRole('searchbox', { name: 'Find a character' }), 'riv')

    const list = within(await screen.findByRole('list', { name: 'Search results' }))
    expect(list.getByRole('link', { name: /Rival/ })).toHaveAttribute('href', '/inspect/2')
    expect(list.getByText('Warrior, level 60')).toBeInTheDocument()
  })

  it('does not search on a single letter', async () => {
    const fetchMock = withBoard()
    const { user } = renderRoute('/leaderboard', { me })

    await user.type(await screen.findByRole('searchbox', { name: 'Find a character' }), 'r')

    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/characters/search'))).toBe(false)
  })

  it('says when nobody matches', async () => {
    withBoard({ [SEARCH]: () => json(200, []) })
    const { user } = renderRoute('/leaderboard', { me })

    await user.type(await screen.findByRole('searchbox', { name: 'Find a character' }), 'riv')

    expect(await screen.findByText('No characters found.')).toBeInTheDocument()
  })

  it('says when the search fails', async () => {
    withBoard({ [SEARCH]: () => json(500, { statusCode: 500, message: 'x' }) })
    const { user } = renderRoute('/leaderboard', { me })

    await user.type(await screen.findByRole('searchbox', { name: 'Find a character' }), 'riv')

    await waitFor(() => expect(screen.getByText('Could not search right now.')).toBeInTheDocument(), { timeout: 3000 })
  })
})
