import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi } from '../test/mock-api'
import { clickNav } from '../test/nav'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

/** Makes Math.random produce these game rand() values, over and over. */
const nextRolls = (...values: number[]) => {
  let next = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (values[next++ % values.length] + 0.5) / 32768)
}

const WIN = [4, 9, 14, 19, 0, 1000, 9]
const LOSS = [4, 9, 14, 19, 0, 1000, 0]

const open = async () => {
  mockApi()
  const rendered = renderRoute('/soul-lottery', { me })
  const play = await screen.findByRole('button', { name: 'Play the lottery' })
  return { ...rendered, play }
}

const total = (name: string) => screen.getByRole('definition', { name })

describe('soul lottery simulator', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is linked from the header', async () => {
    mockApi()
    const { user, router } = renderRoute('/characters', { me })

    await clickNav(user, 'Tools', 'Soul Lottery')

    await waitFor(() => expect(router.state.location.pathname).toBe('/soul-lottery'))
    expect(await screen.findByRole('heading', { name: 'Soul Lottery Simulator', level: 1 })).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/soul-lottery', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('says it is only a simulation', async () => {
    await open()

    expect(screen.getByText(/nothing here changes your characters or gold/i)).toBeInTheDocument()
  })

  it('shows the numbers, the draw and the prize after a win', async () => {
    const { user, play } = await open()
    nextRolls(...WIN)

    await user.click(play)

    const result = screen.getByRole('status')
    expect(within(result).getByText('You won 75g 405s 822c')).toBeInTheDocument()
    expect(within(result).getByRole('list', { name: 'Your numbers' })).toHaveTextContent('5101520')
    expect(within(result).getByText('Drawn number: 10')).toBeInTheDocument()
  })

  it('shows the consolation prize after a loss', async () => {
    const { user, play } = await open()
    nextRolls(...LOSS)

    await user.click(play)

    const result = screen.getByRole('status')
    expect(within(result).getByText('You lost and got 60s')).toBeInTheDocument()
    expect(within(result).getByText('The prize was 75g 405s 822c')).toBeInTheDocument()
  })

  it('uses the chosen level', async () => {
    const { user, play } = await open()
    await user.selectOptions(screen.getByLabelText('Character level'), '1')
    nextRolls(...LOSS)

    await user.click(play)

    expect(within(screen.getByRole('status')).getByText('You lost and got 1s')).toBeInTheDocument()
  })

  it('adds up every lottery played, and starts over on reset', async () => {
    const { user, play } = await open()

    nextRolls(...WIN)
    await user.click(play)
    nextRolls(...LOSS)
    await user.click(play)

    expect(total('Played')).toHaveTextContent('2')
    expect(total('Won')).toHaveTextContent('1')
    expect(total('Lost')).toHaveTextContent('1')
    expect(total('Gold')).toHaveTextContent('75g 465s 822c')

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(total('Played')).toHaveTextContent('0')
    expect(total('Gold')).toHaveTextContent('0c')
    expect(screen.getByRole('status')).toHaveTextContent('Press the button to play.')
  })
})
