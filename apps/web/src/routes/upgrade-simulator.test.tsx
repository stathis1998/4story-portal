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

const FAIL = 99

const open = async () => {
  mockApi()
  const rendered = renderRoute('/upgrade-simulator', { me })
  const attempt = await screen.findByRole('button', { name: 'Upgrade once' })
  return { ...rendered, attempt }
}

const openGems = async () => {
  const rendered = await open()
  await rendered.user.click(screen.getByRole('tab', { name: 'Gemstones' }))
  return { ...rendered, attempt: await screen.findByRole('button', { name: 'Add one gemstone' }) }
}

const total = (name: string) => screen.getByRole('definition', { name })
const select = (name: string) => screen.getByRole('combobox', { name })

describe('upgrade simulator', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is linked from the header', async () => {
    mockApi()
    const { user, router } = renderRoute('/characters', { me })

    await clickNav(user, 'Tools', 'Upgrade Simulator')

    await waitFor(() => expect(router.state.location.pathname).toBe('/upgrade-simulator'))
    expect(await screen.findByRole('heading', { name: 'Upgrade Simulator', level: 1 })).toBeInTheDocument()
  })

  it('says it changes nothing in the game', async () => {
    await open()
    expect(screen.getByText(/nothing here changes your items/i)).toBeInTheDocument()
  })

  describe('upgrades', () => {
    it('shows the chance for the level and Serendipity chosen', async () => {
      const { user } = await open()

      await user.selectOptions(select('Starting level'), '+20')
      expect(screen.getByText('1%')).toBeInTheDocument()

      await user.selectOptions(select('Serendipity'), '300%')
      expect(screen.getByText('4%')).toBeInTheDocument()
    })

    it('raises the item on a success and counts it', async () => {
      const { user, attempt } = await open()
      nextRolls(0)

      await user.click(attempt)

      expect(screen.getByRole('status')).toHaveTextContent('Success! The item is now +11.')
      expect(screen.getByText('Current item: +11')).toBeInTheDocument()
      expect(total('Attempts')).toHaveTextContent('1')
      expect(total('Successes')).toHaveTextContent('1')
    })

    it('destroys the item with no Tincture, until you start again', async () => {
      const { user, attempt } = await open()
      nextRolls(FAIL)

      await user.click(attempt)

      expect(screen.getByRole('status')).toHaveTextContent('The upgrade failed and the item was destroyed.')
      expect(total('Items destroyed')).toHaveTextContent('1')
      expect(attempt).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'Start with a new item' }))
      expect(attempt).toBeEnabled()
      expect(screen.getByText('Current item: +10')).toBeInTheDocument()
      expect(total('Items destroyed')).toHaveTextContent('1')
    })

    it('loses levels with a Survival Tincture above +11', async () => {
      const { user, attempt } = await open()
      await user.selectOptions(select('Starting level'), '+14')
      await user.selectOptions(select('Tincture'), 'Survival Tincture')
      nextRolls(FAIL, 30)

      await user.click(attempt)

      expect(screen.getByRole('status')).toHaveTextContent('The upgrade failed and the item dropped to +13.')
      expect(total('Tinctures used')).toHaveTextContent('1')
    })

    it('does not use a Greater Tincture below +19', async () => {
      const { user, attempt } = await open()
      await user.selectOptions(select('Starting level'), '+18')
      await user.selectOptions(select('Tincture'), 'Greater Survival Tincture')
      nextRolls(FAIL)

      await user.click(attempt)

      expect(screen.getByRole('status')).toHaveTextContent('The upgrade failed but the item stayed at +18.')
      expect(total('Tinctures used')).toHaveTextContent('0')
    })

    it('uses one Serendipity Potion per attempt, even on a failure', async () => {
      const { user, attempt } = await open()
      await user.selectOptions(select('Serendipity'), '100%')
      await user.selectOptions(select('Tincture'), 'Survival Tincture')
      nextRolls(FAIL)

      await user.click(attempt)

      expect(total('Serendipity used')).toHaveTextContent('1')
    })

    it('keeps upgrading until it reaches the target', async () => {
      const { user } = await open()
      await user.selectOptions(select('Upgrade to'), '+13')
      nextRolls(0)

      await user.click(screen.getByRole('button', { name: 'Upgrade to target' }))

      expect(screen.getByRole('status')).toHaveTextContent('Reached +13 after 3 attempts.')
      expect(total('Attempts')).toHaveTextContent('3')
    })

    it('stops when the item is destroyed on the way', async () => {
      const { user } = await open()
      nextRolls(0, FAIL)

      await user.click(screen.getByRole('button', { name: 'Upgrade to target' }))

      expect(screen.getByRole('status')).toHaveTextContent('Destroyed at +11 after 2 attempts.')
    })

    it('gives up after 100,000 attempts', async () => {
      const { user } = await open()
      await user.selectOptions(select('Starting level'), '+18')
      await user.selectOptions(select('Tincture'), 'Greater Survival Tincture')
      nextRolls(FAIL)

      await user.click(screen.getByRole('button', { name: 'Upgrade to target' }))

      expect(screen.getByRole('status')).toHaveTextContent('Stopped at +18 after 100,000 attempts.')
    })

    it('has nothing to try at +24', async () => {
      const { user, attempt } = await open()
      await user.selectOptions(select('Starting level'), '+23')
      nextRolls(0)

      await user.click(attempt)

      expect(attempt).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Upgrade to target' })).toBeDisabled()
    })

    it('starts over when the starting level changes', async () => {
      const { user, attempt } = await open()
      nextRolls(0)
      await user.click(attempt)

      await user.selectOptions(select('Starting level'), '+5')

      expect(screen.getByText('Current item: +5')).toBeInTheDocument()
    })

    it('clears the totals on Reset', async () => {
      const { user, attempt } = await open()
      nextRolls(0)
      await user.click(attempt)

      await user.click(screen.getByRole('button', { name: 'Reset' }))

      expect(total('Attempts')).toHaveTextContent('0')
    })
  })

  describe('gemstones', () => {
    it('shows the chance for the stone chosen', async () => {
      const { user } = await openGems()
      expect(screen.getByText('66%')).toBeInTheDocument()

      await user.selectOptions(select('Gemstone'), 'Cash Gemstone')
      expect(screen.getByText('100%')).toBeInTheDocument()
    })

    it('adds a gem on a success', async () => {
      const { user, attempt } = await openGems()
      nextRolls(0)

      await user.click(attempt)

      expect(screen.getByRole('status')).toHaveTextContent('Success! The item now has 1 gem.')
      expect(screen.getByText('Current gems: 1')).toBeInTheDocument()
    })

    it('resets to 0 gems on a failure', async () => {
      const { user, attempt } = await openGems()
      await user.selectOptions(select('Starting gems'), '3')
      nextRolls(FAIL)

      await user.click(attempt)

      expect(screen.getByRole('status')).toHaveTextContent('It failed and the item now has 0 gems.')
      expect(total('Failures')).toHaveTextContent('1')
    })

    it('loses only one gem with a Perfect Gemstone', async () => {
      const { user, attempt } = await openGems()
      await user.selectOptions(select('Starting gems'), '4')
      await user.selectOptions(select('Gemstone'), 'Perfect Gemstone')
      nextRolls(FAIL)

      await user.click(attempt)

      expect(screen.getByText('Current gems: 3')).toBeInTheDocument()
    })

    it('keeps going to 5 gems', async () => {
      const { user } = await openGems()
      await user.selectOptions(select('Gemstone'), 'Green Gemstone')

      await user.click(screen.getByRole('button', { name: 'Keep adding to 5 gems' }))

      expect(screen.getByRole('status')).toHaveTextContent('Reached 5 gems after 5 stones.')
      expect(total('Gemstones used')).toHaveTextContent('5')
    })

    it('explains that a plain Gemstone cannot pass 2 gems', async () => {
      const { user } = await openGems()
      await user.selectOptions(select('Starting gems'), '2')
      await user.selectOptions(select('Gemstone'), 'Gemstone')

      expect(screen.getByText('0%')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Keep adding to 5 gems' })).toBeDisabled()
    })

    it('has nothing to try at 5 gems', async () => {
      const { user, attempt } = await openGems()
      await user.selectOptions(select('Starting gems'), '4')
      await user.selectOptions(select('Gemstone'), 'Green Gemstone')

      await user.click(attempt)

      expect(attempt).toBeDisabled()
      expect(within(screen.getByRole('tabpanel')).getByText('Current gems: 5')).toBeInTheDocument()
    })
  })
})
