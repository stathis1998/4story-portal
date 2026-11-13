import type { AchievementReward, GmAchievements } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }
const player = { userId: 2, username: 'plain', isGm: false }

const oneRune: AchievementReward = { gold: 1, silver: 0, copper: 0, items: [] }

const state = (overrides: Partial<GmAchievements> = {}): GmAchievements => ({
  live: false,
  control: 'connected',
  awards: 12,
  pendingAnnouncements: 2,
  lastCheck: '2026-11-13T21:14:05',
  achievements: [
    {
      id: 'slayer',
      name: 'Slayer',
      category: 'combat',
      levels: [
        { level: 1, goal: 'Defeat 100 monsters', reward: oneRune },
        { level: 2, goal: 'Defeat 1,000 monsters', reward: null },
        { level: 3, goal: 'Defeat 10,000 monsters', reward: null },
      ],
    },
    { id: 'ouch', name: 'Ouch', category: 'misfortune', levels: [{ level: 1, goal: 'Die for the first time', reward: null }] },
  ],
  ...overrides,
})

/** The same state with Slayer II paying `reward`. */
const withSlayerTwo = (reward: AchievementReward) => {
  const next = state()
  next.achievements[0].levels[1].reward = reward
  return next
}

const base = (extra: Parameters<typeof mockApi>[0] = {}, current: GmAchievements = state()) => ({
  'GET /gm/achievements': () => json(200, current),
  ...extra,
})

const found = (itemId: number, name: string, stack = 20) => ({
  itemId, name, level: 1, icon: null, stack, base: 0, multiplier: 0, price: 0, soldBy: 0, inClient: true, canSellBack: true,
})
const search = { 'GET /gm/items?q=pot&shop=money': () => json(200, [found(51, 'Small Potion')]) }

const status = async () => within(await screen.findByRole('region', { name: 'Status' }))
const rowOf = (name: string) => screen.getByRole('button', { name: `Edit reward for ${name}` }).closest('li')!

describe('GM achievements page', () => {
  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/achievements', { me: player })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it('is reachable from the other GM pages', async () => {
    mockApi(base({ 'GET /gm/logins': () => json(200, []) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(within(await screen.findByRole('navigation', { name: 'GM tools' })).getByRole('link', { name: 'Achievements' }))

    expect(await screen.findByRole('region', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Achievements', level: 1 })).toBeInTheDocument()
  })

  it('shows the worker at a glance', async () => {
    mockApi(base())
    renderRoute('/gm/achievements', { me: gm })

    const row = await status()
    expect(row.getByRole('status')).toHaveTextContent('Connected')
    expect(row.getByText('Awards').nextElementSibling).toHaveTextContent('12')
    expect(row.getByText('Pending announcements').nextElementSibling).toHaveTextContent('2')
    expect(row.getByText('Last check').nextElementSibling).toHaveTextContent('13 Nov 21:14')
    expect(row.getByRole('switch', { name: 'Go live' })).not.toBeChecked()
    expect(row.getByText(/Rewards are off/)).toBeInTheDocument()
  })

  it('says when the worker has not run and the control server is away', async () => {
    mockApi(base({}, state({ control: 'disconnected', lastCheck: null })))
    renderRoute('/gm/achievements', { me: gm })

    const row = await status()
    expect(row.getByRole('status')).toHaveTextContent('Disconnected')
    expect(row.getByText('Last check').nextElementSibling).toHaveTextContent('Not yet')
  })

  describe('going live', () => {
    it('asks first, because it mails and announces everything already completed', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const fetchMock = mockApi(base({ 'PUT /gm/achievements/live': () => json(200, state({ live: true })) }))
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click((await status()).getByRole('switch', { name: 'Go live' }))

      await waitFor(() => expect(screen.getByRole('switch', { name: 'Go live' })).toBeChecked())
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(confirm.mock.calls[0][0]).toMatch(/already completed will be mailed and announced now/)
      expect(sentBodies(fetchMock, 'PUT /gm/achievements/live')).toEqual([{ live: true }])
      expect(screen.getByText(/Rewards are live/)).toBeInTheDocument()
    })

    it('stays off when the GM says no', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click((await status()).getByRole('switch', { name: 'Go live' }))

      expect(sentBodies(fetchMock, 'PUT /gm/achievements/live')).toEqual([])
      expect(screen.getByRole('switch', { name: 'Go live' })).not.toBeChecked()
    })

    it('switches off without asking', async () => {
      const confirm = vi.spyOn(window, 'confirm')
      const fetchMock = mockApi(base({ 'PUT /gm/achievements/live': () => json(200, state({ live: false })) }, state({ live: true })))
      const { user } = renderRoute('/gm/achievements', { me: gm })

      const toggle = (await status()).getByRole('switch', { name: 'Go live' })
      expect(toggle).toBeChecked()
      await user.click(toggle)

      await waitFor(() => expect(screen.getByRole('switch', { name: 'Go live' })).not.toBeChecked())
      expect(confirm).not.toHaveBeenCalled()
      expect(sentBodies(fetchMock, 'PUT /gm/achievements/live')).toEqual([{ live: false }])
    })

    it('shows why the switch failed and leaves it as it was', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockApi(base({ 'PUT /gm/achievements/live': () => json(503, { statusCode: 503, message: 'Settings could not be saved' }) }))
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click((await status()).getByRole('switch', { name: 'Go live' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be saved')
      expect(screen.getByRole('switch', { name: 'Go live' })).not.toBeChecked()
    })
  })

  describe('test announcement', () => {
    it('says when it was sent', async () => {
      const fetchMock = mockApi(base({ 'POST /gm/achievements/test-announcement': () => new Response(null, { status: 204 }) }))
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click((await status()).getByRole('button', { name: 'Send test announcement' }))

      expect(await screen.findByText('Test announcement sent.')).toBeInTheDocument()
      expect(fetchMock.mock.calls.filter(([input]) => input === '/api/gm/achievements/test-announcement')).toHaveLength(1)
    })

    it("shows the API's message when the control server is not connected", async () => {
      mockApi(
        base({
          'POST /gm/achievements/test-announcement': () =>
            json(503, { statusCode: 503, message: 'The control server is not connected' }),
        }),
      )
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click((await status()).getByRole('button', { name: 'Send test announcement' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('The control server is not connected')
      expect(screen.queryByText('Test announcement sent.')).not.toBeInTheDocument()
    })
  })

  describe('rewards', () => {
    it('groups the achievements by category, counting the levels that pay', async () => {
      mockApi(base())
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await screen.findByRole('tablist')
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Combat 1/3', 'Misfortune 0/1'])
      expect(screen.getByRole('heading', { name: 'Slayer', level: 3 })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Ouch' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Misfortune 0/1' }))
      expect(screen.getByRole('heading', { name: 'Ouch', level: 3 })).toBeInTheDocument()
      // One level, so no numeral.
      expect(rowOf('Ouch')).toHaveTextContent('Die for the first time')
    })

    it('lists each level with its goal and what it pays', async () => {
      mockApi(base())
      renderRoute('/gm/achievements', { me: gm })

      await screen.findByRole('tablist')
      expect(rowOf('Slayer I')).toHaveTextContent('Defeat 100 monsters')
      expect(within(rowOf('Slayer I')).getByRole('img', { name: 'Rune' }).parentElement).toHaveTextContent('1')
      expect(rowOf('Slayer II')).toHaveTextContent('Defeat 1,000 monsters')
      expect(rowOf('Slayer II')).toHaveTextContent('No reward')
    })

    it('saves a level, shows the answer, and moves on to the next level', async () => {
      const reward = { gold: 5, silver: 0, copper: 250, items: [{ itemId: 51, count: 2, name: 'Small Potion', icon: null }] }
      const fetchMock = mockApi(base({ ...search, 'PUT /gm/achievements/rewards': () => json(200, withSlayerTwo(reward)) }))
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit reward for Slayer II' }))
      const form = within(screen.getByRole('form', { name: 'Reward for Slayer II' }))
      expect(form.getByLabelText('Rune')).toHaveFocus()
      await user.clear(form.getByLabelText('Rune'))
      await user.type(form.getByLabelText('Rune'), '5')
      await user.clear(form.getByLabelText('Cron'))
      await user.type(form.getByLabelText('Cron'), '250')
      await user.click(form.getByRole('button', { name: 'Add item' }))
      // Enter in the search box must not save the half-made reward.
      await user.type(form.getByLabelText('Find an item'), 'pot{Enter}')
      await user.click(await form.findByRole('button', { name: /Small Potion/ }))
      const count = form.getByRole('spinbutton', { name: 'Count for Small Potion' })
      await user.clear(count)
      await user.type(count, '2')
      expect(sentBodies(fetchMock, 'PUT /gm/achievements/rewards')).toEqual([])
      await user.click(form.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())
      expect(sentBodies(fetchMock, 'PUT /gm/achievements/rewards')).toEqual([
        { achievementId: 'slayer', level: 2, reward: { gold: 5, silver: 0, copper: 250, items: [{ itemId: 51, count: 2 }] } },
      ])
      // From the PUT's answer: the GET still says there is no reward.
      expect(rowOf('Slayer II')).toHaveTextContent('Small Potion')
      expect(rowOf('Slayer II')).not.toHaveTextContent('No reward')
      expect(screen.getByRole('tab', { name: 'Combat 2/3' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit reward for Slayer III' })).toHaveFocus()
    })

    it('starts from the reward a level already has, and clears it with all zeros', async () => {
      const cleared = state()
      cleared.achievements[0].levels[0].reward = null
      const fetchMock = mockApi(base({ 'PUT /gm/achievements/rewards': () => json(200, cleared) }))
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit reward for Slayer I' }))
      const form = within(screen.getByRole('form', { name: 'Reward for Slayer I' }))
      expect(form.getByLabelText('Rune')).toHaveValue(1)
      await user.clear(form.getByLabelText('Rune'))
      await user.click(form.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(rowOf('Slayer I')).toHaveTextContent('No reward'))
      expect(sentBodies(fetchMock, 'PUT /gm/achievements/rewards')).toEqual([
        { achievementId: 'slayer', level: 1, reward: { gold: 0, silver: 0, copper: 0, items: [] } },
      ])
    })

    it("shows the API's 422 message in the editor and keeps it open", async () => {
      mockApi(
        base({ 'PUT /gm/achievements/rewards': () => json(422, { statusCode: 422, message: 'Item 51 is not in the client' }) }),
      )
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit reward for Slayer II' }))
      const form = within(screen.getByRole('form', { name: 'Reward for Slayer II' }))
      await user.clear(form.getByLabelText('Rune'))
      await user.type(form.getByLabelText('Rune'), '5')
      await user.click(form.getByRole('button', { name: 'Save' }))

      expect(await form.findByRole('alert')).toHaveTextContent('Item 51 is not in the client')
      expect(form.getByLabelText('Rune')).toHaveValue(5)
    })

    it('refuses more than 999 Luna without asking the API', async () => {
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit reward for Slayer II' }))
      const form = within(screen.getByRole('form', { name: 'Reward for Slayer II' }))
      await user.clear(form.getByLabelText('Luna'))
      await user.type(form.getByLabelText('Luna'), '1000')
      await user.click(form.getByRole('button', { name: 'Save' }))

      expect(await form.findByRole('alert')).toHaveTextContent(/^Luna: /)
      expect(sentBodies(fetchMock, 'PUT /gm/achievements/rewards')).toEqual([])
    })

    it('cancels back to the row', async () => {
      mockApi(base())
      const { user } = renderRoute('/gm/achievements', { me: gm })

      await user.click(await screen.findByRole('button', { name: 'Edit reward for Slayer II' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('form')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit reward for Slayer II' })).toHaveFocus()
    })
  })
})
