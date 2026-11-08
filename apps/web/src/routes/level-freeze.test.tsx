import type { CharacterProfile, LevelFreeze } from '@4story-portal/shared'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }
const PUT = 'PUT /characters/1/level-freeze'

const profile: CharacterProfile = {
  id: 1,
  name: 'Kaelith',
  level: 40,
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

function setup(freeze: Partial<LevelFreeze>, put?: (body: unknown) => Response) {
  const state: LevelFreeze = { level: 40, freezeLevel: null, online: false, ...freeze }
  const fetchMock = mockApi({
    'GET /characters/1/profile': () => json(200, profile),
    'GET /characters/1/level-freeze': () => json(200, state),
    [PUT]: put ?? ((body) => json(200, { ...state, freezeLevel: (body as { level: number | null }).level })),
  })
  return { fetchMock, ...renderRoute('/characters/1', { me }) }
}

const levelField = () => screen.findByLabelText('Freeze at level')

describe('level freeze section', () => {
  it('freezes the character at the chosen level', async () => {
    const { fetchMock, user } = setup({})

    expect(await screen.findByText(/^Not frozen/)).toBeInTheDocument()
    await user.clear(await levelField())
    await user.type(await levelField(), '50')
    await user.click(screen.getByRole('button', { name: 'Save freeze' }))

    expect(await screen.findByText(/^Frozen at level 50/)).toBeInTheDocument()
    expect(sentBodies(fetchMock, PUT)).toEqual([{ level: 50 }])
  })

  it('removes a freeze', async () => {
    const { fetchMock, user } = setup({ freezeLevel: 55 })

    expect(await screen.findByText(/^Frozen at level 55/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove freeze' }))

    expect(await screen.findByText(/^Not frozen/)).toBeInTheDocument()
    expect(sentBodies(fetchMock, PUT)).toEqual([{ level: null }])
  })

  it('has no remove button without a freeze', async () => {
    setup({})

    await screen.findByText(/^Not frozen/)
    expect(screen.queryByRole('button', { name: 'Remove freeze' })).not.toBeInTheDocument()
  })

  it('refuses a level below the current one without calling the server', async () => {
    const { fetchMock, user } = setup({})

    await user.clear(await levelField())
    await user.type(await levelField(), '39')
    await user.click(screen.getByRole('button', { name: 'Save freeze' }))

    expect(await screen.findByText('Choose a level from 40 to 89')).toBeInTheDocument()
    expect(sentBodies(fetchMock, PUT)).toEqual([])
  })

  it('asks an online character to log out instead of offering the form', async () => {
    setup({ online: true, freezeLevel: 55 })

    expect(await screen.findByText(/^Frozen at level 55/)).toBeInTheDocument()
    expect(screen.getByText('Log out of the game with this character to change this.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Freeze at level')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove freeze' })).not.toBeInTheDocument()
  })

  it('shows why the server refused', async () => {
    const { user } = setup({}, () =>
      json(409, { statusCode: 409, message: 'Log out of the game with this character first' }),
    )

    await levelField()
    await user.click(screen.getByRole('button', { name: 'Save freeze' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Log out of the game with this character first')
  })

  it('offers nothing at the top level', async () => {
    setup({ level: 90 })

    expect(await screen.findByText('This character is already at the highest level.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByLabelText('Freeze at level')).not.toBeInTheDocument())
  })
})
