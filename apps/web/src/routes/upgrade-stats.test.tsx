import type { UpgradeKindStats, UpgradeStats } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { character } from '../test/characters'
import { json, mockApi } from '../test/mock-api'
import { clickNav } from '../test/nav'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(12 + i).padStart(2, '0')}`, success: 0, failed: 0 }))

const kind = (overrides: Partial<UpgradeKindStats> = {}): UpgradeKindStats => ({
  totals: { success: 5, saved: 1, lostLevels: 1, destroyed: 1 },
  expectedSuccesses: 3.4,
  levels: [
    { level: 0, success: 4, saved: 0, lostLevels: 0, destroyed: 0, expectedRate: 1 },
    { level: 11, success: 1, saved: 1, lostLevels: 1, destroyed: 1, expectedRate: 0.35 },
  ],
  days,
  you: { success: 1, saved: 0, lostLevels: 0, destroyed: 1, expectedSuccesses: 1.35 },
  ...overrides,
})

const empty = kind({
  totals: { success: 0, saved: 0, lostLevels: 0, destroyed: 0 },
  expectedSuccesses: 0,
  levels: [],
  you: { success: 0, saved: 0, lostLevels: 0, destroyed: 0, expectedSuccesses: 0 },
})

const stats = (overrides: Partial<UpgradeStats> = {}): UpgradeStats => ({
  today: '2026-11-10',
  character: null,
  since: '2026-11-10',
  scroll: kind(),
  gem: empty,
  losses: [
    { characterId: 4, name: 'Khadgar', className: 'Wizard', level: 60, item: 'Wooden Wand', upgrade: 11, date: '2026-11-10', mine: false },
    { characterId: 1, name: 'Kaelith', className: 'Warrior', level: 50, item: 'Sword', upgrade: 9, date: '2026-11-09', mine: true },
  ],
  ranked: true,
  ...overrides,
})

const route = (body: UpgradeStats = stats()) => ({ 'GET /upgrade-stats': () => json(200, body) })

describe('upgrade stats page', () => {
  it('is linked from the header', async () => {
    mockApi(route())
    const { user, router } = renderRoute('/characters', { me })

    await clickNav(user, 'Rankings', 'Upgrade Stats')

    await waitFor(() => expect(router.state.location.pathname).toBe('/upgrade-stats'))
    expect(await screen.findByRole('heading', { name: 'Upgrade Stats', level: 1 })).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/upgrade-stats', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('leads with the success rate and how it compares with the odds', async () => {
    mockApi(route())
    renderRoute('/upgrade-stats', { me })

    const totals = await screen.findByRole('region', { name: 'Totals' })
    expect(within(totals).getByText('63%')).toBeInTheDocument()
    expect(within(totals).getByText(/5 of 8 upgrade rolls won, 1.6 more than the odds predicted/)).toBeInTheDocument()
    expect(within(totals).getByText('Items destroyed').nextSibling).toHaveTextContent('1')
    expect(screen.getByText(/counted since 10 Nov/)).toBeInTheDocument()
  })

  it('draws the charts with every number also in the table', async () => {
    const { user } = renderUpgradeStats()

    expect(await screen.findByRole('img', { name: /Upgrade outcomes at each level/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Success rate at each level against the odds/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+11: 1 won, 3 failed' })).toBeInTheDocument()
    // The empty levels between +0 and +11 still get a column.
    expect(screen.getByRole('button', { name: '+5: 0 won, 0 failed' })).toBeInTheDocument()

    await user.click(screen.getByText('Every level as a table'))
    const row = screen.getByRole('row', { name: /\+11/ })
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['+11', '4', '1', '1', '1', '1', '25%', '35%'])
  })

  it('shows the details of a level on hover', async () => {
    const { user } = renderUpgradeStats()

    await user.hover(await screen.findByRole('button', { name: '+11: 1 won, 3 failed' }))

    expect(await screen.findByText('+11: 4 attempts')).toBeInTheDocument()
    expect(screen.getByText('won, odds said 35%')).toBeInTheDocument()
  })

  it("shows the viewer's record and the Wall of Misfortune, marking their own loss", async () => {
    mockApi(route())
    renderRoute('/upgrade-stats', { me })

    const record = await screen.findByRole('region', { name: 'Your record' })
    expect(within(record).getByText('50%')).toBeInTheDocument()
    expect(within(record).getByText(/1 of 2 won, 0.4 fewer than the odds predicted/)).toBeInTheDocument()

    const wall = screen.getByRole('region', { name: 'Wall of Misfortune' })
    const items = within(wall).getAllByRole('listitem')
    expect(within(items[0]).getByText('+11')).toBeInTheDocument()
    expect(within(items[0]).getByText('Wooden Wand')).toBeInTheDocument()
    expect(within(items[0]).getByRole('link', { name: 'Khadgar' })).toHaveAttribute('href', '/inspect/4')
    expect(within(items[1]).getByText('You')).toBeInTheDocument()
    expect(within(items[1]).getByRole('link', { name: 'Kaelith' })).toHaveAttribute('href', '/characters/1')
  })

  it('switches to gemstones, which nobody has tried yet', async () => {
    const { user } = renderUpgradeStats()

    await user.click(await screen.findByRole('tab', { name: 'Gemstones' }))

    expect(screen.getByText(/Nobody has tried a gemstone yet/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Wall of Misfortune' })).not.toBeInTheDocument()
  })

  it("narrows to one of your characters, keeping it in the address and dropping your record", async () => {
    const kaelith = { id: 1, name: 'Kaelith', className: 'Warrior', level: 50, mine: true }
    mockApi({
      'GET /characters': () => json(200, [character({ id: 1, name: 'Kaelith' })]),
      'GET /upgrade-stats': () => json(200, stats()),
      'GET /upgrade-stats?character=1': () => json(200, stats({ character: kaelith, losses: [] })),
    })
    const { user, router } = renderRoute('/upgrade-stats', { me })
    expect(await screen.findByRole('region', { name: 'Your record' })).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Kaelith' }))

    await waitFor(() => expect(router.state.location.search).toEqual({ character: 1 }))
    expect(await screen.findByText(/roll by Kaelith/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Your record' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kaelith' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Everyone' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it("finds another player's character by name", async () => {
    mockApi({
      'GET /characters/search?q=Kha': () => json(200, [{ id: 4, name: 'Khadgar', level: 60, className: 'Wizard' }]),
      'GET /upgrade-stats': () => json(200, stats()),
      'GET /upgrade-stats?character=4': () => json(200, stats()),
    })
    const { user, router } = renderRoute('/upgrade-stats', { me })

    await user.type(await screen.findByLabelText("Another player's character"), 'Kha')
    await user.click(await screen.findByRole('button', { name: /Khadgar/ }))

    await waitFor(() => expect(router.state.location.search).toEqual({ character: 4 }))
  })

  it("explains when a character can't be shown", async () => {
    mockApi({ 'GET /upgrade-stats?character=999': () => json(404, { message: 'Character not found' }) })
    renderRoute('/upgrade-stats?character=999', { me })

    expect(await screen.findByText(/That character can't be shown/)).toBeInTheDocument()
  })

  it('says when a GM is left out of the totals', async () => {
    mockApi(route(stats({ ranked: false })))
    renderRoute('/upgrade-stats', { me })

    expect(await screen.findByText('GM, not counted in the server totals.')).toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    mockApi({ 'GET /upgrade-stats': () => json(500, { message: 'boom' }) })
    renderRoute('/upgrade-stats', { me })

    expect(await screen.findByText('Could not load the Upgrade Stats.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

function renderUpgradeStats() {
  mockApi(route())
  return renderRoute('/upgrade-stats', { me })
}
