import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi } from '../test/mock-api'
import { clickNav } from '../test/nav'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

/** Makes Math.random produce these game rand() values, over and over. */
const nextRolls = (...values: number[]) => {
  let next = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (values[next++ % values.length] + 0.5) / 32768)
}

const FAIL = 99

const NO_GAME_PRICES = {
  apprentice: 0,
  master: 0,
  reflection: 0,
  potion100: 0,
  potion150: 0,
  potion200: 0,
  potion300: 0,
  survival: 0,
  medium: 0,
  greater: 0,
}
const TRANUS = { ...NO_GAME_PRICES, apprentice: 10_000, master: 100_000, potion300: 10_000_000, greater: 40_000_000 }

/** Opens the simulator with the game charging `gamePrices`, in Cron: nothing unless a test says so. */
const open = async (gamePrices: Partial<typeof NO_GAME_PRICES> | 'fails' = {}) => {
  mockApi({
    'GET /upgrade-prices': () => (gamePrices === 'fails' ? json(500, { statusCode: 500, message: 'Down' }) : json(200, { ...NO_GAME_PRICES, ...gamePrices })),
  })
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
const price = (name: string) => screen.getByRole('spinbutton', { name })
const results = () => screen.getByRole('region', { name: 'Simulation results' })
/** The average and the p50, p90, p95 and p99 of one row of the simulation results. */
const used = (name: string) =>
  within(within(results()).getByRole('row', { name: new RegExp(`^${name}`) }))
    .getAllByRole('cell')
    .map((cell) => cell.textContent)

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

    describe('prices', () => {
      it("start as the game's prices", async () => {
        await open(TRANUS)

        await waitFor(() => expect(price("Apprentice's Formula Luna")).toHaveValue(10))
        expect(price("Master's Formula Luna")).toHaveValue(100)
        expect(price('Serendipity 300% Rune')).toHaveValue(10)
        expect(price('Greater Survival Tincture Rune')).toHaveValue(40)
        expect(price('Survival Tincture Luna')).toHaveValue(0)
        expect(screen.getByText(/These start as what Tranus charges in the game/)).toBeInTheDocument()
      })

      it("cost a run at the game's prices with nothing filled in", async () => {
        const { user } = await open(TRANUS)
        await waitFor(() => expect(price("Apprentice's Formula Luna")).toHaveValue(10))
        await user.selectOptions(select('Upgrade to'), '+13')
        nextRolls(0)

        await user.click(screen.getByRole('button', { name: 'Upgrade to target' }))

        // Three Apprentice's Formulas at 10 Luna.
        expect(used('Cost')).toEqual(['30', '30', '30', '30', '30'])
      })

      it('keep a price the user changed, while the rest follow the game', async () => {
        const first = await open(TRANUS)
        await waitFor(() => expect(price("Apprentice's Formula Luna")).toHaveValue(10))
        await first.user.clear(price("Apprentice's Formula Luna"))
        await first.user.type(price("Apprentice's Formula Luna"), '12')
        cleanup()

        // A GM has since doubled both formulas.
        await open({ ...TRANUS, apprentice: 20_000, master: 200_000 })

        await waitFor(() => expect(price("Master's Formula Luna")).toHaveValue(200))
        expect(price("Apprentice's Formula Luna")).toHaveValue(12)
      })

      it("follow the game again for a price put back to the game's", async () => {
        const first = await open(TRANUS)
        await waitFor(() => expect(price("Apprentice's Formula Luna")).toHaveValue(10))
        await first.user.clear(price("Apprentice's Formula Luna"))
        await first.user.type(price("Apprentice's Formula Luna"), '12')
        await first.user.clear(price("Apprentice's Formula Luna"))
        await first.user.type(price("Apprentice's Formula Luna"), '10')
        cleanup()

        await open({ ...TRANUS, apprentice: 20_000 })

        await waitFor(() => expect(price("Apprentice's Formula Luna")).toHaveValue(20))
      })

      it("go back to the game's on request, and stay there", async () => {
        const first = await open(TRANUS)
        await waitFor(() => expect(price("Apprentice's Formula Luna")).toHaveValue(10))
        await first.user.clear(price("Apprentice's Formula Luna"))
        await first.user.type(price("Apprentice's Formula Luna"), '12')

        await first.user.click(screen.getByRole('button', { name: "Use the game's prices" }))

        expect(price("Apprentice's Formula Luna")).toHaveValue(10)
        cleanup()
        await open(TRANUS)
        await waitFor(() => expect(price("Master's Formula Luna")).toHaveValue(100))
        expect(price("Apprentice's Formula Luna")).toHaveValue(10)
      })

      it("can make an item free that the game charges for", async () => {
        const first = await open(TRANUS)
        await waitFor(() => expect(price("Apprentice's Formula Luna")).toHaveValue(10))
        await first.user.clear(price("Apprentice's Formula Luna"))
        await first.user.type(price("Apprentice's Formula Luna"), '0')
        cleanup()

        await open(TRANUS)

        await waitFor(() => expect(price("Master's Formula Luna")).toHaveValue(100))
        expect(price("Apprentice's Formula Luna")).toHaveValue(0)
      })

      it("say so when the game's prices cannot be loaded, and still take the user's", async () => {
        const { user } = await open('fails')

        expect(await screen.findByText(/Could not load the game's prices/)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: "Use the game's prices" })).not.toBeInTheDocument()
        await user.selectOptions(select('Upgrade to'), '+13')
        await user.clear(price("Apprentice's Formula Cron"))
        await user.type(price("Apprentice's Formula Cron"), '7')
        nextRolls(0)

        await user.click(screen.getByRole('button', { name: 'Upgrade to target' }))

        expect(used('Cost')).toEqual(['21', '21', '21', '21', '21'])
      })
    })

    describe('to a target', () => {
      const toTarget = () => screen.getByRole('button', { name: 'Upgrade to target' })

      it('runs 10,000 items and shows what they used', async () => {
        const { user } = await open()
        await user.selectOptions(select('Upgrade to'), '+13')
        await user.selectOptions(select('Serendipity'), '100%')
        nextRolls(0)

        await user.click(toTarget())

        expect(screen.getByRole('status')).toHaveTextContent('Ran 10,000 items from +10 to +13: 100% reached it.')
        expect(within(results()).getByRole('heading', { name: '10,000 runs from +10 to +13' })).toBeInTheDocument()
        expect(results()).toHaveTextContent('Reached +13 in 100% of runs.')
        expect(within(results()).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Used', 'Average', 'p50', 'p90', 'p95', 'p99'])
        expect(used('Attempts')).toEqual(['3', '3', '3', '3', '3'])
        expect(used('Serendipity')).toEqual(['3', '3', '3', '3', '3'])
        expect(used('Tinctures')).toEqual(['0', '0', '0', '0', '0'])
        expect(used('Reflections')).toEqual(['0', '0', '0', '0', '0'])
      })

      it('shows what the runs cost at the prices filled in', async () => {
        const { user } = await open()
        await user.selectOptions(select('Upgrade to'), '+13')
        await user.selectOptions(select('Serendipity'), '100%')
        await user.clear(price("Apprentice's Formula Luna"))
        await user.type(price("Apprentice's Formula Luna"), '10')
        await user.clear(price('Serendipity 100% Luna'))
        await user.type(price('Serendipity 100% Luna'), '5')
        await user.clear(price('Serendipity 100% Cron'))
        await user.type(price('Serendipity 100% Cron'), '500')
        nextRolls(0)

        await user.click(toTarget())

        // Three attempts, each one scroll and one Serendipity: 3 x 15 Luna 500 Cron is 46 Luna 500 Cron.
        expect(used('Cost')).toEqual(['46500', '46500', '46500', '46500', '46500'])
        const cost = within(results()).getByRole('row', { name: /^Cost/ })
        expect(within(cost).getAllByAltText('Luna')).toHaveLength(5)
        expect(within(cost).getAllByAltText('Cron')).toHaveLength(5)
        expect(within(cost).queryByAltText('Rune')).not.toBeInTheDocument()
        expect(results()).toHaveTextContent('Cost is at your prices, without the upgrade fee the NPC takes.')
      })

      it('has no cost with no prices, or with a price field emptied', async () => {
        const { user } = await open()
        await user.selectOptions(select('Upgrade to'), '+13')
        await user.clear(price("Apprentice's Formula Cron"))
        nextRolls(0)

        await user.click(toTarget())

        expect(used('Attempts')).toEqual(['3', '3', '3', '3', '3'])
        expect(within(results()).queryByRole('row', { name: /^Cost/ })).not.toBeInTheDocument()
      })

      it('remembers the prices for the next visit', async () => {
        const first = await open()
        await first.user.clear(price('Greater Survival Tincture Rune'))
        await first.user.type(price('Greater Survival Tincture Rune'), '3')
        await first.user.clear(price('Greater Survival Tincture Luna'))
        await first.user.type(price('Greater Survival Tincture Luna'), '1500')
        cleanup()

        await open()

        // 1,500 Luna comes back as 1 Rune and 500 Luna.
        expect(price('Greater Survival Tincture Rune')).toHaveValue(4)
        expect(price('Greater Survival Tincture Luna')).toHaveValue(500)
        expect(price('Greater Survival Tincture Cron')).toHaveValue(0)
        expect(price('Survival Tincture Rune')).toHaveValue(0)
      })

      it('leaves the item and the totals as they were', async () => {
        const { user } = await open()
        await user.selectOptions(select('Upgrade to'), '+13')
        nextRolls(0)

        await user.click(toTarget())

        expect(screen.getByText('Current item: +10')).toBeInTheDocument()
        expect(total('Attempts')).toHaveTextContent('0')
      })

      it('starts from the level the item is at now', async () => {
        const { user, attempt } = await open()
        await user.selectOptions(select('Upgrade to'), '+13')
        nextRolls(0)
        await user.click(attempt)

        await user.click(toTarget())

        expect(within(results()).getByRole('heading', { name: '10,000 runs from +11 to +13' })).toBeInTheDocument()
        expect(used('Attempts')).toEqual(['2', '2', '2', '2', '2'])
      })

      it('says how often the item was destroyed on the way', async () => {
        const { user } = await open()
        await user.selectOptions(select('Upgrade to'), '+11')
        // Runs take turns: one success, then one failure with no Tincture.
        nextRolls(0, FAIL)

        await user.click(toTarget())

        expect(screen.getByRole('status')).toHaveTextContent('Ran 10,000 items from +10 to +11: 50% reached it.')
        expect(results()).toHaveTextContent('Reached +11 in 50% of runs. The item was destroyed in 50%.')
        expect(used('Attempts')).toEqual(['1', '1', '1', '1', '1'])
      })

      it('has no table when every item was destroyed', async () => {
        const { user } = await open()
        nextRolls(0, FAIL)

        await user.click(toTarget())

        expect(results()).toHaveTextContent('Reached +24 in 0% of runs. The item was destroyed in 100%.')
        expect(within(results()).queryByRole('table')).not.toBeInTheDocument()
      })

      it('gives up when a run is still going after 100,000 attempts', async () => {
        const { user } = await open()
        await user.selectOptions(select('Starting level'), '+18')
        await user.selectOptions(select('Tincture'), 'Greater Survival Tincture')
        nextRolls(FAIL)

        await user.click(toTarget())

        const stopped = 'Stopped: a run was still going after 100,000 attempts, so this setup is very unlikely to ever reach +24.'
        expect(screen.getByRole('status')).toHaveTextContent(stopped)
        expect(results()).toHaveTextContent(stopped)
        expect(screen.getByText('Current item: +18')).toBeInTheDocument()
      })
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

    describe('Scroll of Reflection', () => {
      it('lowers the item one level and uses no Serendipity or Tincture', async () => {
        const { user, attempt } = await open()
        await user.selectOptions(select('Starting level'), '+20')
        await user.selectOptions(select('Serendipity'), '100%')
        await user.selectOptions(select('Tincture'), 'Survival Tincture')
        await user.selectOptions(select('Scroll'), 'Scroll of Reflection')

        await user.click(attempt)

        expect(screen.getByRole('status')).toHaveTextContent('The Scroll of Reflection lowered the item to +19.')
        expect(total('Attempts')).toHaveTextContent('1')
        expect(total('Reflections used')).toHaveTextContent('1')
        expect(total('Serendipity used')).toHaveTextContent('0')
        expect(total('Tinctures used')).toHaveTextContent('0')
      })

      it('switches the Serendipity and the Tincture off, keeping what was chosen', async () => {
        const { user } = await open()
        await user.selectOptions(select('Serendipity'), '100%')

        await user.selectOptions(select('Scroll'), 'Scroll of Reflection')
        expect(select('Serendipity')).toBeDisabled()
        expect(select('Tincture')).toBeDisabled()

        await user.selectOptions(select('Scroll'), "Master's Formula")
        expect(select('Serendipity')).toBeEnabled()
        expect(select('Serendipity')).toHaveValue('100')
        expect(select('Tincture')).toBeEnabled()
        expect(screen.getByText('90%')).toBeInTheDocument()
      })

      it('shows where the item goes instead of a chance', async () => {
        const { user } = await open()
        await user.selectOptions(select('Scroll'), 'Scroll of Reflection')

        expect(screen.getByText('Drops to +9')).toBeInTheDocument()
        expect(screen.queryByText('45%')).not.toBeInTheDocument()
      })

      it('cannot upgrade to a target on its own', async () => {
        const { user } = await open()
        await user.selectOptions(select('Scroll'), 'Scroll of Reflection')

        expect(screen.getByRole('button', { name: 'Upgrade to target' })).toBeDisabled()
      })

      it('cannot be used at +0', async () => {
        const { user, attempt } = await open()
        await user.selectOptions(select('Starting level'), '+0')
        await user.selectOptions(select('Scroll'), 'Scroll of Reflection')

        expect(attempt).toBeDisabled()
      })
    })

    describe('a setup per level', () => {
      const perLevel = () => screen.getByRole('checkbox', { name: 'Use a different setup per level' })

      it('starts every level with the setup already chosen', async () => {
        const { user } = await open()
        await user.selectOptions(select('Scroll'), "Master's Formula")
        await user.selectOptions(select('Serendipity'), '200%')

        await user.click(perLevel())

        expect(select('Scroll at +3')).toHaveValue('master')
        expect(select('Serendipity at +23')).toHaveValue('200')
        expect(select('Tincture at +23')).toHaveValue('none')
        expect(screen.queryByRole('combobox', { name: 'Scroll at +24' })).not.toBeInTheDocument()
      })

      it('uses the row for the level the item is at', async () => {
        const { user, attempt } = await open()
        await user.click(perLevel())
        await user.selectOptions(select('Tincture at +10'), 'Survival Tincture')
        nextRolls(FAIL)

        await user.click(attempt)

        expect(screen.getByRole('status')).toHaveTextContent('The upgrade failed but the item stayed at +10.')
        expect(total('Tinctures used')).toHaveTextContent('1')
      })

      it('shows the chance for the row of the current level', async () => {
        const { user } = await open()
        await user.click(perLevel())

        await user.selectOptions(select('Serendipity at +10'), '100%')

        expect(screen.getAllByText('90%')).toHaveLength(2)
      })

      it('changes setup as the item changes level on the way to the target', async () => {
        const { user } = await open()
        await user.selectOptions(select('Starting level'), '+20')
        await user.selectOptions(select('Upgrade to'), '+21')
        await user.click(perLevel())
        await user.selectOptions(select('Scroll at +20'), 'Scroll of Reflection')
        await user.selectOptions(select('Scroll at +19'), "Master's Formula")
        // No roll for the Scroll of Reflection, then a success at +19 and a Master's Formula step of 3.
        nextRolls(0, 2)

        await user.click(screen.getByRole('button', { name: 'Upgrade to target' }))

        expect(results()).toHaveTextContent('Reached +21 in 100% of runs.')
        expect(used('Attempts')).toEqual(['2', '2', '2', '2', '2'])
        expect(used('Reflections')).toEqual(['1', '1', '1', '1', '1'])
      })

      it('copies the setup on top to every level', async () => {
        const { user } = await open()
        await user.click(perLevel())
        await user.selectOptions(select('Tincture'), 'Greater Survival Tincture')
        expect(select('Tincture at +5')).toHaveValue('none')

        await user.click(screen.getByRole('button', { name: 'Apply to all levels' }))

        expect(select('Tincture at +5')).toHaveValue('greater')
      })

      it('does not offer the Scroll of Reflection at +0', async () => {
        const { user } = await open()
        await user.click(perLevel())

        expect(within(select('Scroll at +0')).getByRole('option', { name: 'Scroll of Reflection' })).toBeDisabled()
        expect(within(select('Scroll at +1')).getByRole('option', { name: 'Scroll of Reflection' })).toBeEnabled()
      })

      it('switches the Serendipity and the Tincture off in a row with a Scroll of Reflection', async () => {
        const first = await open()
        await first.user.click(perLevel())
        await first.user.selectOptions(select('Serendipity at +20'), '300%')

        await first.user.selectOptions(select('Scroll at +20'), 'Scroll of Reflection')

        expect(select('Serendipity at +20')).toBeDisabled()
        expect(select('Tincture at +20')).toBeDisabled()
        expect(select('Serendipity at +19')).toBeEnabled()
        cleanup()

        // The row is still remembered whole, with the Serendipity it had.
        await open()
        expect(select('Scroll at +20')).toHaveValue('reflection')
        expect(select('Serendipity at +20')).toHaveValue('300')
        expect(select('Serendipity at +20')).toBeDisabled()
      })

      it('marks the row of the current level', async () => {
        const { user } = await open()
        await user.click(perLevel())

        expect(screen.getByRole('row', { current: true })).toHaveTextContent('+10')
      })

      it('goes back to one setup when it is turned off', async () => {
        const { user, attempt } = await open()
        await user.click(perLevel())
        await user.selectOptions(select('Tincture at +10'), 'Survival Tincture')
        await user.click(perLevel())
        nextRolls(FAIL)

        await user.click(attempt)

        expect(screen.getByRole('status')).toHaveTextContent('The upgrade failed and the item was destroyed.')
      })

      it('is remembered for the next visit', async () => {
        const first = await open()
        await first.user.click(perLevel())
        await first.user.selectOptions(select('Scroll at +19'), "Master's Formula")
        cleanup()

        await open()

        expect(perLevel()).toBeChecked()
        expect(select('Scroll at +19')).toHaveValue('master')
        expect(select('Scroll at +18')).toHaveValue('apprentice')
      })

      it('keeps the remembered rows when it is turned on again', async () => {
        const first = await open()
        await first.user.click(perLevel())
        await first.user.selectOptions(select('Scroll at +19'), "Master's Formula")
        await first.user.click(perLevel())
        cleanup()

        const { user } = await open()
        expect(perLevel()).not.toBeChecked()
        await user.click(perLevel())

        expect(select('Scroll at +19')).toHaveValue('master')
      })
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
