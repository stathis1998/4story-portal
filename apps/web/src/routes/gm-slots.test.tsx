import type { GmSlotMachine, GmSlots, SlotSpinView } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }

const NONE = { spins: 0, staked: 0, paid: 0, added: 0 }

const machine = (overrides: Partial<GmSlotMachine> & Pick<GmSlotMachine, 'key' | 'stakes'>): GmSlotMachine => ({
  live: true,
  today: NONE,
  allTime: NONE,
  ...overrides,
})

const spin = (overrides: Partial<SlotSpinView> = {}): SlotSpinView => ({
  id: 1,
  at: '2026-11-14T09:05:00.000Z',
  character: 'Moosey',
  machine: 'shelf',
  stops: [0, 0, 0],
  stake: 25,
  payout: 125,
  jackpot: 0,
  ...overrides,
})

const state = (overrides: Partial<GmSlots> = {}): GmSlots => ({
  live: false,
  machines: [
    machine({ key: 'shelf', stakes: [10, 25, 50], today: { spins: 3, staked: 2500, paid: 1000, added: 0 }, allTime: { spins: 120, staked: 1_500_000, paid: 1_400_000, added: 0 } }),
    machine({ key: 'armoury', stakes: [25, 50, 100] }),
    machine({ key: 'hoard', stakes: [50, 100, 200] }),
  ],
  // Stop 0 on the shelf is the lucky symbol on every reel; the armoury's win line at stop 1 shows three different symbols.
  latest: [spin(), spin({ id: 2, at: '2026-11-13T21:30:00.000Z', character: 'Mounara', machine: 'armoury', stops: [1, 1, 1], stake: 100, payout: 0 })],
  jackpot: { live: true, setCap: 50, running: null, added: 0, paid: 0, drops: 0, wins: [] },
  ...overrides,
})

const base = (extra: Parameters<typeof mockApi>[0] = {}, current: GmSlots = state()) => ({
  'GET /gm/slots': () => json(200, current),
  ...extra,
})

const floor = async () => within(await screen.findByRole('region', { name: 'Status' }))
const section = async (name: string) => within(await screen.findByRole('region', { name }))

describe('GM slots page', () => {
  it('is linked from the GM menu and shows the floor switch and three machines', async () => {
    mockApi(base({ 'GET /gm/logins': () => json(200, []) }))
    const { user } = renderRoute('/gm/logins', { me: gm })

    await user.click(within(await screen.findByRole('navigation', { name: 'GM tools' })).getByRole('link', { name: 'Slots' }))

    expect(await screen.findByRole('heading', { name: 'Slots', level: 1 })).toBeInTheDocument()
    const row = await floor()
    expect(row.getByRole('switch', { name: 'Slots open' })).not.toBeChecked()
    expect(row.getByText('Players see the machines and cannot spin.')).toBeInTheDocument()

    const shelf = await section("Tranus's Shelf")
    expect(shelf.getByRole('switch', { name: "Tranus's Shelf open" })).toBeChecked()
    expect(shelf.getByRole('spinbutton', { name: 'Lowest stake' })).toHaveValue(10)
    expect(shelf.getByRole('spinbutton', { name: 'Middle stake' })).toHaveValue(25)
    expect(shelf.getByRole('spinbutton', { name: 'Highest stake' })).toHaveValue(50)
    expect(shelf.getByRole('button', { name: 'Save stakes' })).toBeInTheDocument()
    expect(shelf.getByText('The most one spin can win at these stakes is 5 Gold.')).toBeInTheDocument()
    expect(shelf.getByText('Pays back 95.8% by its reels.')).toBeInTheDocument()
    expect((await section('The Armoury')).getByText('Pays back 95.7% by its reels.')).toBeInTheDocument()
    expect((await section("Dragon's Hoard")).getByText('Pays back 96.1% by its reels.')).toBeInTheDocument()

    const today = within(shelf.getByRole('region', { name: 'Today' }))
    expect(today.getByText('Spins').nextElementSibling).toHaveTextContent('3')
    expect(today.getByText('Staked').nextElementSibling).toHaveTextContent('2 Gold 500 Silver')
    expect(today.getByText('Paid out').nextElementSibling).toHaveTextContent('1 Gold')
    expect(today.getByText('House result').nextElementSibling).toHaveTextContent('1 Gold 500 Silver')
    expect(today.getByText('Paid back so far').nextElementSibling).toHaveTextContent('40.0%')
    const allTime = within(shelf.getByRole('region', { name: 'All time' }))
    expect(allTime.getByText('House result').nextElementSibling).toHaveTextContent('100 Gold')
    expect(allTime.getByText('Paid back so far').nextElementSibling).toHaveTextContent('93.3%')
    // No spins yet: nothing to divide.
    const armouryToday = within((await section('The Armoury')).getByRole('region', { name: 'Today' }))
    expect(armouryToday.getByText('Paid back so far').nextElementSibling).toHaveTextContent('-')
  })

  it('opens and closes the floor', async () => {
    const fetchMock = mockApi(base({ 'PUT /gm/slots/floor': () => json(200, state({ live: true })) }))
    const { user } = renderRoute('/gm/slots', { me: gm })

    await user.click((await floor()).getByRole('switch', { name: 'Slots open' }))

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Slots open' })).toBeChecked())
    expect(sentBodies(fetchMock, 'PUT /gm/slots/floor')).toEqual([{ live: true }])
    expect(screen.getByText('Players can spin.')).toBeInTheDocument()
  })

  it('closes a machine, sending its saved stakes', async () => {
    const next = state()
    next.machines[1] = machine({ key: 'armoury', live: false, stakes: [25, 50, 100] })
    const fetchMock = mockApi(base({ 'PUT /gm/slots/machines/armoury': () => json(200, next) }))
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    // Half-typed stakes must not leak into the switch's save.
    await user.type(armoury.getByRole('spinbutton', { name: 'Lowest stake' }), '9')
    await user.click(armoury.getByRole('switch', { name: 'The Armoury open' }))

    await waitFor(() => expect(screen.getByRole('switch', { name: 'The Armoury open' })).not.toBeChecked())
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([{ live: false, stakes: [25, 50, 100] }])
  })

  it("saves new stakes, sending the machine's saved switch", async () => {
    const next = state()
    next.machines[1] = machine({ key: 'armoury', stakes: [20, 40, 80] })
    const fetchMock = mockApi(base({ 'PUT /gm/slots/machines/armoury': () => json(200, next) }))
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    for (const [name, value] of [
      ['Lowest stake', '20'],
      ['Middle stake', '40'],
      ['Highest stake', '80'],
    ]) {
      await user.clear(armoury.getByRole('spinbutton', { name }))
      await user.type(armoury.getByRole('spinbutton', { name }), value)
    }
    await user.click(armoury.getByRole('button', { name: 'Save stakes' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([{ live: true, stakes: [20, 40, 80] }])
    await waitFor(() => expect(armoury.getByRole('spinbutton', { name: 'Lowest stake' })).toHaveValue(20))
    // Only that machine's form was touched.
    expect((await section("Dragon's Hoard")).getByRole('spinbutton', { name: 'Lowest stake' })).toHaveValue(50)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not send stakes that are not three different rising ones', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    const lowest = armoury.getByRole('spinbutton', { name: 'Lowest stake' })
    await user.clear(lowest)
    await user.type(lowest, '60')
    await user.click(armoury.getByRole('button', { name: 'Save stakes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter three different stakes, lowest first')
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([])
  })

  it('does not send a stake that is not a whole number', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    const middle = armoury.getByRole('spinbutton', { name: 'Middle stake' })
    await user.clear(middle)
    await user.click(armoury.getByRole('button', { name: 'Save stakes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a whole number')
    expect(middle).toHaveAttribute('aria-invalid', 'true')
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([])
  })

  it('shows the largest win for the stakes typed', async () => {
    mockApi(base())
    const { user } = renderRoute('/gm/slots', { me: gm })

    const hoard = await section("Dragon's Hoard")
    expect(hoard.getByText('The most one spin can win at these stakes is 100 Gold.')).toBeInTheDocument()
    for (const [name, value] of [
      ['Lowest stake', '100'],
      ['Middle stake', '200'],
      ['Highest stake', '500'],
    ]) {
      await user.clear(hoard.getByRole('spinbutton', { name }))
      await user.type(hoard.getByRole('spinbutton', { name }), value)
    }

    expect(hoard.getByText('The most one spin can win at these stakes is 250 Gold.')).toBeInTheDocument()
    expect(hoard.getByText('500 Silver')).toBeInTheDocument()
    // The other machines keep what they had.
    expect((await section('The Armoury')).getByText('The most one spin can win at these stakes is 25 Gold.')).toBeInTheDocument()
  })

  it('shows the house down when a machine has paid more than it took, and the share paid back', async () => {
    const current = state()
    current.machines[2] = machine({ key: 'hoard', stakes: [50, 100, 200], today: { spins: 1, staked: 1000, paid: 3600, added: 0 } })
    mockApi(base({}, current))
    renderRoute('/gm/slots', { me: gm })

    const today = within((await section("Dragon's Hoard")).getByRole('region', { name: 'Today' }))
    expect(today.getByText('House result').nextElementSibling).toHaveTextContent('-2 Gold 600 Silver')
    expect(today.getByText('Paid back so far').nextElementSibling).toHaveTextContent('360.0%')
  })

  it('lists the latest spins with their symbols', async () => {
    mockApi(base())
    renderRoute('/gm/slots', { me: gm })

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'When',
      'Character',
      'Machine',
      'Symbols',
      'Staked',
      'Paid',
    ])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['14 Nov, 09:05', 'Moosey', "Tranus's Shelf", '', '25 Silver', '125 Silver'],
      ['13 Nov, 21:30', 'Mounara', 'The Armoury', '', '100 Silver', '0 Silver'],
    ])
    const symbols = rows.map((row) => within(row).getAllByRole('img').map((img) => img.getAttribute('alt')))
    expect(symbols).toEqual([
      ['Healing Potion', 'Healing Potion', 'Healing Potion'],
      ['Dragon String Bow', 'Diamond Axe', 'Sword of Judgement'],
    ])
    // At the icons' own 32 px: drawn pixelated, a smaller size drops rows of pixels.
    for (const img of rows.flatMap((row) => within(row).getAllByRole('img'))) {
      expect(img).toHaveAttribute('width', '32')
      expect(img).toHaveAttribute('height', '32')
    }
  })

  it('skips a spin on a machine the page does not know', async () => {
    mockApi(base({}, state({ latest: [spin({ id: 3, machine: 'vault' as never, character: 'Ghost' }), spin()] })))
    renderRoute('/gm/slots', { me: gm })

    const table = await screen.findByRole('table')
    expect(within(table).queryByText('Ghost')).not.toBeInTheDocument()
    expect(within(table).getByText('Moosey')).toBeInTheDocument()
  })

  it('says so when nobody has spun', async () => {
    mockApi(base({}, state({ latest: [] })))
    renderRoute('/gm/slots', { me: gm })

    expect(await screen.findByText('Nobody has spun yet.')).toBeInTheDocument()
  })

  it('shows why a switch could not be saved', async () => {
    mockApi(base({ 'PUT /gm/slots/floor': () => json(403, { statusCode: 403, message: 'Not allowed' }) }))
    const { user } = renderRoute('/gm/slots', { me: gm })

    await user.click((await floor()).getByRole('switch', { name: 'Slots open' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
  })

  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/slots', { me: { userId: 2, username: 'plain', isGm: false } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it('says so when the page cannot be loaded', async () => {
    mockApi({ 'GET /gm/slots': () => json(500, { statusCode: 500, message: 'Down' }) })
    renderRoute('/gm/slots', { me: gm })

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the slot machines.')
  })

  describe('jackpot', () => {
    const jackpot = (overrides: Partial<GmSlots['jackpot']> = {}): GmSlots['jackpot'] => ({
      live: true,
      setCap: 50,
      running: { pot: 12_345, cap: 50_000, floor: 5000 },
      added: 20_000,
      paid: 7000,
      drops: 2,
      wins: [],
      ...overrides,
    })
    const jackpotSection = () => section('Jackpot')
    const capField = 'Cap for the next jackpot, in Gold'

    it('shows the switch, the saved cap, the pot and the totals', async () => {
      mockApi(base({}, state({ jackpot: jackpot() })))
      renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      expect(box.getByRole('switch', { name: 'Jackpot on' })).toBeChecked()
      expect(box.getByText('Lost rounds add to the pot.')).toBeInTheDocument()
      expect(box.getByRole('spinbutton', { name: capField })).toHaveValue(50)
      expect(box.getByText('Can drop from 5 Gold, must drop before 50 Gold.')).toBeInTheDocument()
      expect(box.getByText('Pot now').nextElementSibling).toHaveTextContent('12 Gold 345 Silver')
      expect(box.getByText('Must drop before 50 Gold.')).toBeInTheDocument()
      expect(box.getByText('Added').nextElementSibling).toHaveTextContent('20 Gold')
      expect(box.getByText('Paid out').nextElementSibling).toHaveTextContent('7 Gold')
      expect(box.getByText('Drops').nextElementSibling).toHaveTextContent('2')
    })

    it('says what an off jackpot does', async () => {
      mockApi(base({}, state({ jackpot: jackpot({ live: false }) })))
      renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      expect(box.getByRole('switch', { name: 'Jackpot on' })).not.toBeChecked()
      expect(box.getByText('The pot is kept. Lost rounds add nothing and it cannot drop.')).toBeInTheDocument()
    })

    it('switches off, sending the saved cap and not what is typed', async () => {
      const fetchMock = mockApi(base({ 'PUT /gm/slots/jackpot': () => json(200, state({ jackpot: jackpot({ live: false }) })) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      await user.clear(box.getByRole('spinbutton', { name: capField }))
      await user.type(box.getByRole('spinbutton', { name: capField }), '9')
      await user.click(box.getByRole('switch', { name: 'Jackpot on' }))

      await waitFor(() => expect(screen.getByRole('switch', { name: 'Jackpot on' })).not.toBeChecked())
      expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpot')).toEqual([{ live: false, cap: 50 }])
    })

    it('saves a new cap, sending the saved switch', async () => {
      const fetchMock = mockApi(base({ 'PUT /gm/slots/jackpot': () => json(200, state({ jackpot: jackpot({ setCap: 80 }) })) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      const field = box.getByRole('spinbutton', { name: capField })
      await user.clear(field)
      await user.type(field, '80')
      await user.click(box.getByRole('button', { name: 'Save cap' }))

      await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpot')).toEqual([{ live: true, cap: 80 }]))
      await waitFor(() => expect(field).toHaveValue(80))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it.each([
      ['0', 'From 1 to 10,000 Gold'],
      ['10001', 'From 1 to 10,000 Gold'],
      ['1.5', 'Enter a whole number'],
      ['abc', 'Enter a whole number'],
      ['', 'Enter a whole number'],
    ])('does not send a cap of %j', async (typed, message) => {
      const fetchMock = mockApi(base({}, state({ jackpot: jackpot() })))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      const field = box.getByRole('spinbutton', { name: capField })
      await user.clear(field)
      if (typed) await user.type(field, typed)
      await user.click(box.getByRole('button', { name: 'Save cap' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpot')).toEqual([])
    })

    it('sends the edge caps 1 and 10000', async () => {
      const fetchMock = mockApi(base({ 'PUT /gm/slots/jackpot': () => json(200, state({ jackpot: jackpot() })) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      const field = box.getByRole('spinbutton', { name: capField })
      for (const [typed, count] of [
        ['1', 1],
        ['10000', 2],
      ] as const) {
        await user.clear(field)
        await user.type(field, typed)
        await user.click(box.getByRole('button', { name: 'Save cap' }))
        await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpot')).toHaveLength(count))
      }
      expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpot')).toEqual([
        { live: true, cap: 1 },
        { live: true, cap: 10_000 },
      ])
    })

    it('shows the range the typed cap gives, and none while it is not a whole number in range', async () => {
      mockApi(base({}, state({ jackpot: jackpot() })))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      const field = box.getByRole('spinbutton', { name: capField })
      await user.clear(field)
      await user.type(field, '80')
      expect(box.getByText('Can drop from 8 Gold, must drop before 80 Gold.')).toBeInTheDocument()
      await user.clear(field)
      await user.type(field, '0')
      expect(box.queryByText(/Can drop from/)).not.toBeInTheDocument()
    })

    it('shows both caps when the running jackpot keeps an older one', async () => {
      mockApi(base({}, state({ jackpot: jackpot({ setCap: 80, running: { pot: 1000, cap: 50_000, floor: 5000 } }) })))
      renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      expect(box.getByText('This jackpot must drop before 50 Gold. The next one: 80 Gold.')).toBeInTheDocument()
      expect(box.queryByText('Must drop before 50 Gold.')).not.toBeInTheDocument()
    })

    it('says so when the pot cannot be read, and the switch and cap still work', async () => {
      const fetchMock = mockApi(
        base({ 'PUT /gm/slots/jackpot': () => json(200, state({ jackpot: jackpot({ running: null, live: false }) })) }, state({ jackpot: jackpot({ running: null }) })),
      )
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotSection()
      expect(box.getByText("The jackpot's table is not in this database yet.")).toBeInTheDocument()
      expect(box.queryByText('Pot now')).not.toBeInTheDocument()
      await user.click(box.getByRole('switch', { name: 'Jackpot on' }))
      await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpot')).toEqual([{ live: false, cap: 50 }]))
      await user.clear(box.getByRole('spinbutton', { name: capField }))
      await user.type(box.getByRole('spinbutton', { name: capField }), '70')
      await user.click(box.getByRole('button', { name: 'Save cap' }))
      await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpot')).toHaveLength(2))
    })

    it('lists the drops', async () => {
      const wins = [spin({ id: 9, at: '2026-11-14T09:05:00.000Z', character: 'Moosey', machine: 'hoard', stake: 200, payout: 50_000, jackpot: 50_000 })]
      mockApi(base({}, state({ jackpot: jackpot({ wins }), latest: [] })))
      renderRoute('/gm/slots', { me: gm })

      const table = (await jackpotSection()).getByRole('table', { name: 'Jackpot drops' })
      expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['When', 'Character', 'Machine', 'Won'])
      expect(within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
        ['14 Nov, 09:05', 'Moosey', "Dragon's Hoard", '50 Gold'],
      ])
    })

    it('says so when nobody has won the jackpot', async () => {
      mockApi(base({}, state({ jackpot: jackpot() })))
      renderRoute('/gm/slots', { me: gm })

      expect((await jackpotSection()).getByText('Nobody has won the jackpot yet.')).toBeInTheDocument()
    })

    it('shows why a jackpot save failed', async () => {
      mockApi(base({ 'PUT /gm/slots/jackpot': () => json(403, { statusCode: 403, message: 'Not allowed' }) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      await user.click((await jackpotSection()).getByRole('switch', { name: 'Jackpot on' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    })

    it('shows what a machine sent to the jackpot, and takes it out of the house result', async () => {
      const current = state()
      current.machines[1] = machine({ key: 'armoury', stakes: [25, 50, 100], today: { spins: 5, staked: 1000, paid: 900, added: 40 } })
      mockApi(base({}, current))
      renderRoute('/gm/slots', { me: gm })

      const today = within((await section('The Armoury')).getByRole('region', { name: 'Today' }))
      expect(today.getByText('To the jackpot').nextElementSibling).toHaveTextContent('40 Silver')
      expect(today.getByText('House result').nextElementSibling).toHaveTextContent('60 Silver')
    })

    it('marks a jackpot round in the latest spins', async () => {
      mockApi(base({}, state({ latest: [spin({ payout: 50_002, jackpot: 50_002 })] })))
      renderRoute('/gm/slots', { me: gm })

      const table = await screen.findByRole('table', { name: 'Latest spins' })
      expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Jackpot 50 Gold 2 Silver')
    })
  })
})
