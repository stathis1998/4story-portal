import type { CharacterProfile, RebirthState } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }
const GET = 'GET /characters/1/rebirth'
const POST = 'POST /characters/1/rebirth'

const profile: CharacterProfile = {
  id: 1,
  name: 'Kaelith',
  level: 90,
  rebirth: 0,
  className: 'Wizard',
  race: 'Human',
  country: 'Defugel',
  progress: null,
  ageDays: null,
  hoursPlayed: 0,
  daysPlayed: 0,
  longestStreak: 0,
  longestSessionMinutes: 0,
  gear: [],
  companions: [],
  titles: [],
  titlesTotal: 110,
  ranked: true,
  rankings: [],
}

const ready: RebirthState = {
  characterId: 1,
  name: 'Kaelith',
  level: 90,
  online: false,
  wornItems: 0,
  wallet: { gold: 5000, silver: 0, copper: 0 },
  rebirths: 1,
  bonus: 2,
  open: true,
  next: { number: 2, bonus: 4, priceGold: 4000 },
}

function setup(state: Partial<RebirthState>, post?: (body: unknown) => Response) {
  const current: RebirthState = { ...ready, ...state }
  const fetchMock = mockApi({
    'GET /characters/1/profile': () => json(200, profile),
    [GET]: () => json(200, current),
    [POST]: post ?? (() => json(200, { ...current, level: 1, rebirths: 2, bonus: 4, next: null })),
  })
  return { fetchMock, ...renderRoute('/characters/1', { me }) }
}

const beReborn = () => screen.findByRole('button', { name: 'Be reborn' })
const calls = (fetchMock: ReturnType<typeof mockApi>, key: string) => sentBodies(fetchMock, key).length

describe('rebirth section', () => {
  it('shows the count, the bonus and the next rebirth', async () => {
    setup({})

    expect(await screen.findByText('Rebirths: 1')).toBeInTheDocument()
    expect(screen.getByText('Bonus: +2% all stats')).toBeInTheDocument()
    expect(screen.getByText('Next: rebirth 2, +4% all stats')).toBeInTheDocument()
    expect(screen.getByText('Level 90')).toBeInTheDocument()
    expect(screen.getByText('Logged out')).toBeInTheDocument()
    expect(screen.getByText('Nothing worn')).toBeInTheDocument()
    expect(screen.getByText('4,000 Gold')).toBeInTheDocument()
    expect(await beReborn()).toBeEnabled()
  })

  it.each([
    ['level', { level: 74 }, 'Level 90 needed, this character is 74'],
    ['online', { online: true }, 'Log out of the game with this character'],
    ['worn', { wornItems: 5 }, '5 items still on'],
    ['gold', { wallet: { gold: 3412, silver: 0, copper: 0 } }, '4,000 Gold needed, this character has 3,412'],
  ] as [string, Partial<RebirthState>, string][])('enables the button only when every line is met: %s', async (_name, state, text) => {
    setup(state)

    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(await beReborn()).toBeDisabled()
  })

  it('says rebirth is closed', async () => {
    setup({ open: false })

    expect(await screen.findByText('Rebirth is closed right now.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing worn')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Be reborn' })).not.toBeInTheDocument()
  })

  it('says the limit is reached', async () => {
    setup({ rebirths: 10, bonus: 20, next: null })

    expect(await screen.findByText('This character has reached the rebirth limit.')).toBeInTheDocument()
    expect(screen.getByText('Rebirths: 10')).toBeInTheDocument()
    expect(screen.getByText('Bonus: +20% all stats')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Be reborn' })).not.toBeInTheDocument()
  })

  it('asks before doing it and sends the price it showed', async () => {
    const { fetchMock, user } = setup({})

    await user.click(await beReborn())
    const dialog = await screen.findByRole('dialog', { name: 'Be reborn as level 1?' })
    expect(within(dialog).getByText('Reset: level, EXP, skills and skill points, quests, the level freeze.')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Kept: items, the rest of your Gold, pets, mounts, titles, guild and friends.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Cost: 4,000 Gold.')).toBeInTheDocument()
    expect(calls(fetchMock, POST)).toBe(0)

    await user.click(within(dialog).getByRole('button', { name: 'Be reborn' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sentBodies(fetchMock, POST)).toEqual([{ priceGold: 4000 }])
  })

  it('does nothing when the confirmation is cancelled', async () => {
    const { fetchMock, user } = setup({})

    await user.click(await beReborn())
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls(fetchMock, POST)).toBe(0)
  })

  it('sends one request when Be reborn is clicked twice', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const current: RebirthState = { ...ready }
    const fetchMock = mockApi({
      'GET /characters/1/profile': () => json(200, profile),
      [GET]: () => json(200, current),
      [POST]: async () => {
        await gate
        return json(200, { ...current, level: 1, rebirths: 2, bonus: 4, next: null })
      },
    })
    const { user } = renderRoute('/characters/1', { me })

    await user.click(await beReborn())
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Be reborn' })
    await user.click(confirm)
    await user.click(confirm)

    expect(confirm).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls(fetchMock, POST)).toBe(1)
  })

  it("shows the server's reason and the fresh state when refused", async () => {
    let price = 4000
    const fetchMock = mockApi({
      'GET /characters/1/profile': () => json(200, profile),
      [GET]: () => json(200, { ...ready, next: { number: 2, bonus: 4, priceGold: price } }),
      [POST]: () => {
        price = 6000
        return json(409, { statusCode: 409, message: 'The price has changed. Check it and confirm again' })
      },
    })
    const { user } = renderRoute('/characters/1', { me })

    await user.click(await beReborn())
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Be reborn' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The price has changed. Check it and confirm again')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('6,000 Gold needed, this character has 5,000')).toBeInTheDocument()
    const gets = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/characters/1/rebirth') && !init?.method)
    expect(gets).toHaveLength(2)
  })

  it('shows the new life after a rebirth', async () => {
    const { user } = setup(
      {},
      () =>
        json(200, {
          ...ready,
          level: 1,
          rebirths: 2,
          bonus: 4,
          wallet: { gold: 1000, silver: 0, copper: 0 },
          next: { number: 3, bonus: 6, priceGold: 6000 },
        }),
    )

    await user.click(await beReborn())
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Be reborn' }))

    expect(await screen.findByText('Rebirths: 2')).toBeInTheDocument()
    expect(screen.getByText('Bonus: +4% all stats')).toBeInTheDocument()
    expect(screen.getByText('Level 90 needed, this character is 1')).toBeInTheDocument()
    expect(screen.getByText('Next: rebirth 3, +6% all stats')).toBeInTheDocument()
  })
})
