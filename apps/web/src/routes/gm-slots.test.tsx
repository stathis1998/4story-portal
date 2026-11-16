import type { GmSlotMachine, GmSlotPot, GmSlots, SlotPot, SlotSpinView } from '@4story-portal/shared'
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
  stops: [0, 0, 0, 0, 0],
  free: [],
  meterFree: [],
  meterBefore: 0,
  stake: 40,
  payout: 1200,
  jackpot: 0,
  pots: { mini: 0, major: 0, giga: 0 },
  ...overrides,
})

const POT_CAPS: Record<SlotPot, number> = { mini: 1, major: 10, giga: 50 }
const pot = (key: SlotPot, overrides: Partial<GmSlotPot> = {}): GmSlotPot => ({
  pot: key,
  live: true,
  setCap: POT_CAPS[key],
  running: null,
  added: 0,
  paid: 0,
  drops: 0,
  wins: [],
  ...overrides,
})
const pots = (overrides: Partial<Record<SlotPot, Partial<GmSlotPot>>> = {}): GmSlotPot[] => (['mini', 'major', 'giga'] as const).map((key) => pot(key, overrides[key]))

const state = (overrides: Partial<GmSlots> = {}): GmSlots => ({
  live: false,
  machines: [
    machine({ key: 'shelf', stakes: [20, 40, 60], today: { spins: 3, staked: 2500, paid: 1000, added: 0 }, allTime: { spins: 120, staked: 1_500_000, paid: 1_400_000, added: 0 } }),
    machine({ key: 'armoury', stakes: [40, 60, 100] }),
    machine({ key: 'hoard', stakes: [60, 100, 200] }),
  ],
  latest: [spin(), spin({ id: 2, at: '2026-11-13T21:30:00.000Z', character: 'Mounara', machine: 'armoury', stops: [1, 1, 1, 1, 1], stake: 100, payout: 0 })],
  jackpots: pots(),
  daily: { limit: 1500 },
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
    expect(shelf.getByRole('spinbutton', { name: 'Lowest stake' })).toHaveValue(20)
    expect(shelf.getByRole('spinbutton', { name: 'Middle stake' })).toHaveValue(40)
    expect(shelf.getByRole('spinbutton', { name: 'Highest stake' })).toHaveValue(60)
    expect(shelf.getByRole('button', { name: 'Save stakes' })).toBeInTheDocument()
    expect(shelf.getByText('The most one paid spin can win at these stakes is 21 Gold 627 Silver.')).toBeInTheDocument()
    expect(shelf.getByText('Pays back 100.8% by its reels.')).toBeInTheDocument()
    expect((await section('The Armoury')).getByText('Pays back 101.0% by its reels.')).toBeInTheDocument()
    expect((await section("Dragon's Hoard")).getByText('Pays back 101.0% by its reels.')).toBeInTheDocument()
    expect(shelf.getByText('At 105%, a player spinning nonstop at 60 Silver gains about 3 Gold 600 Silver an hour.')).toBeInTheDocument()

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
    next.machines[1] = machine({ key: 'armoury', live: false, stakes: [40, 60, 100] })
    const fetchMock = mockApi(base({ 'PUT /gm/slots/machines/armoury': () => json(200, next) }))
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    // Half-typed stakes must not leak into the switch's save.
    await user.type(armoury.getByRole('spinbutton', { name: 'Lowest stake' }), '9')
    await user.click(armoury.getByRole('switch', { name: 'The Armoury open' }))

    await waitFor(() => expect(screen.getByRole('switch', { name: 'The Armoury open' })).not.toBeChecked())
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([{ live: false, stakes: [40, 60, 100] }])
  })

  it("saves new stakes, sending the machine's saved switch", async () => {
    const next = state()
    next.machines[1] = machine({ key: 'armoury', stakes: [20, 80, 120] })
    const fetchMock = mockApi(base({ 'PUT /gm/slots/machines/armoury': () => json(200, next) }))
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    for (const [name, value] of [
      ['Lowest stake', '20'],
      ['Middle stake', '80'],
      ['Highest stake', '120'],
    ]) {
      await user.clear(armoury.getByRole('spinbutton', { name }))
      await user.type(armoury.getByRole('spinbutton', { name }), value)
    }
    await user.click(armoury.getByRole('button', { name: 'Save stakes' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toHaveLength(1))
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([{ live: true, stakes: [20, 80, 120] }])
    await waitFor(() => expect(armoury.getByRole('spinbutton', { name: 'Lowest stake' })).toHaveValue(20))
    // Only that machine's form was touched.
    expect((await section("Dragon's Hoard")).getByRole('spinbutton', { name: 'Lowest stake' })).toHaveValue(60)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not send stakes that are not three different rising ones', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    const lowest = armoury.getByRole('spinbutton', { name: 'Lowest stake' })
    await user.clear(lowest)
    await user.type(lowest, '100')
    await user.click(armoury.getByRole('button', { name: 'Save stakes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter three different stakes in multiples of 20 Silver, lowest first')
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([])
  })

  it('does not send stakes that are not multiples of 20 Silver', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/slots', { me: gm })

    const shelf = await section("Tranus's Shelf")
    for (const [name, value] of [
      ['Lowest stake', '10'],
      ['Middle stake', '25'],
      ['Highest stake', '50'],
    ]) {
      await user.clear(shelf.getByRole('spinbutton', { name }))
      await user.type(shelf.getByRole('spinbutton', { name }), value)
    }
    await user.click(shelf.getByRole('button', { name: 'Save stakes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter three different stakes in multiples of 20 Silver, lowest first')
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/shelf')).toEqual([])
  })

  it('does not send a stake above 5 Gold', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    const highest = armoury.getByRole('spinbutton', { name: 'Highest stake' })
    await user.clear(highest)
    await user.type(highest, '5020')
    await user.click(armoury.getByRole('button', { name: 'Save stakes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter three different stakes in multiples of 20 Silver, lowest first')
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([])
  })

  it('sends a top stake of exactly 5 Gold', async () => {
    const fetchMock = mockApi(base({ 'PUT /gm/slots/machines/armoury': () => json(200, state()) }))
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    const highest = armoury.getByRole('spinbutton', { name: 'Highest stake' })
    await user.clear(highest)
    await user.type(highest, '5000')
    await user.click(armoury.getByRole('button', { name: 'Save stakes' }))

    await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([{ live: true, stakes: [40, 60, 5000] }]))
  })

  it("says what each machine's top stake gains a player nonstop at 105%", async () => {
    mockApi(base())
    renderRoute('/gm/slots', { me: gm })

    expect((await section('The Armoury')).getByText('At 105%, a player spinning nonstop at 100 Silver gains about 6 Gold an hour.')).toBeInTheDocument()
    expect((await section("Dragon's Hoard")).getByText('At 105%, a player spinning nonstop at 200 Silver gains about 12 Gold an hour.')).toBeInTheDocument()
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

  it('tells a stake past what a number holds with the form message', async () => {
    const fetchMock = mockApi(base())
    const { user } = renderRoute('/gm/slots', { me: gm })

    const armoury = await section('The Armoury')
    const highest = armoury.getByRole('spinbutton', { name: 'Highest stake' })
    await user.clear(highest)
    await user.type(highest, '99999999999999999999')
    await user.click(armoury.getByRole('button', { name: 'Save stakes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter three different stakes in multiples of 20 Silver, lowest first')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(sentBodies(fetchMock, 'PUT /gm/slots/machines/armoury')).toEqual([])
  })

  it('shows the largest win for the stakes typed', async () => {
    mockApi(base())
    const { user } = renderRoute('/gm/slots', { me: gm })

    const hoard = await section("Dragon's Hoard")
    expect(hoard.getByText('The most one paid spin can win at these stakes is 300 Gold 170 Silver.')).toBeInTheDocument()
    for (const [name, value] of [
      ['Lowest stake', '100'],
      ['Middle stake', '200'],
      ['Highest stake', '500'],
    ]) {
      await user.clear(hoard.getByRole('spinbutton', { name }))
      await user.type(hoard.getByRole('spinbutton', { name }), value)
    }

    expect(hoard.getByText('The most one paid spin can win at these stakes is 750 Gold 425 Silver.')).toBeInTheDocument()
    expect(hoard.getByText('500 Silver')).toBeInTheDocument()
    expect(hoard.getByText('At 105%, a player spinning nonstop at 500 Silver gains about 30 Gold an hour.')).toBeInTheDocument()
    // The other machines keep what they had.
    expect((await section('The Armoury')).getByText('The most one paid spin can win at these stakes is 61 Gold 625 Silver.')).toBeInTheDocument()
  })

  it('shows the house down when a machine has paid more than it took, and the share paid back', async () => {
    const current = state()
    current.machines[2] = machine({ key: 'hoard', stakes: [60, 100, 200], today: { spins: 1, staked: 1000, paid: 3600, added: 0 } })
    mockApi(base({}, current))
    renderRoute('/gm/slots', { me: gm })

    const today = within((await section("Dragon's Hoard")).getByRole('region', { name: 'Today' }))
    expect(today.getByText('House result').nextElementSibling).toHaveTextContent('-2 Gold 600 Silver')
    expect(today.getByText('Paid back so far').nextElementSibling).toHaveTextContent('360.0%')
  })

  it('lists the latest rounds, with the free spins where there were any', async () => {
    const free = [[1, 1, 1, 1, 1]] as SlotSpinView['free']
    mockApi(base({}, state({ latest: [spin({ free: [...free, ...free, ...free, ...free, ...free, ...free, ...free, ...free] }), spin({ id: 2, at: '2026-11-13T21:30:00.000Z', character: 'Mounara', machine: 'armoury', stops: [1, 1, 1, 1, 1], stake: 100, payout: 0 })] })))
    renderRoute('/gm/slots', { me: gm })

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['When', 'Character', 'Machine', 'Staked', 'Paid'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['14 Nov, 09:05', 'Moosey', "Tranus's Shelf", '40 Silver', '1 Gold 200 Silver with 8 free spins'],
      ['13 Nov, 21:30', 'Mounara', 'The Armoury', '100 Silver', '0 Silver'],
    ])
    expect(within(table).queryAllByRole('img')).toEqual([])
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

  describe('jackpots', () => {
    const running = (potNow: number, cap: number) => ({ pot: potNow, cap, floor: cap / 10 })
    const jackpotsSection = () => section('Jackpots')
    const capField = (name: string) => `${name} cap, in Gold`
    const fill = async (user: ReturnType<typeof renderRoute>['user'], box: ReturnType<typeof within>, name: string, value: string) => {
      const field = box.getByRole('spinbutton', { name: capField(name) })
      await user.clear(field)
      if (value) await user.type(field, value)
    }
    const livePots = () =>
      pots({
        mini: { running: running(600, 1000), added: 5000, paid: 700, drops: 3 },
        major: { running: running(12_345, 10_000) },
        giga: { running: running(12_345, 50_000), added: 20_000, paid: 7000, drops: 2 },
      })

    it('shows each pot with its switch, its saved cap, its pot and its totals', async () => {
      mockApi(base({}, state({ jackpots: livePots() })))
      renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      for (const name of ['Mini', 'Major', 'Giga']) {
        expect(box.getByRole('switch', { name: `${name} on` })).toBeChecked()
      }
      expect(box.getAllByText('Lost rounds add to the pot.')).toHaveLength(3)
      expect(box.getByRole('spinbutton', { name: capField('Mini') })).toHaveValue(1)
      expect(box.getByRole('spinbutton', { name: capField('Major') })).toHaveValue(10)
      expect(box.getByRole('spinbutton', { name: capField('Giga') })).toHaveValue(50)
      expect(box.getByText('Can drop from 100 Silver, must drop before 1 Gold.')).toBeInTheDocument()
      expect(box.getByText('Can drop from 1 Gold, must drop before 10 Gold.')).toBeInTheDocument()
      expect(box.getByText('Can drop from 5 Gold, must drop before 50 Gold.')).toBeInTheDocument()
      const giga = within(box.getByRole('region', { name: 'Giga' }))
      expect(giga.getByText('Pot now').nextElementSibling).toHaveTextContent('12 Gold 345 Silver')
      expect(giga.getByText('Must drop before 50 Gold.')).toBeInTheDocument()
      expect(giga.getByText('Added').nextElementSibling).toHaveTextContent('20 Gold')
      expect(giga.getByText('Paid out').nextElementSibling).toHaveTextContent('7 Gold')
      expect(giga.getByText('Drops').nextElementSibling).toHaveTextContent('2')
      const mini = within(box.getByRole('region', { name: 'Mini' }))
      expect(mini.getByText('Pot now').nextElementSibling).toHaveTextContent('600 Silver')
      expect(mini.getByText('Drops').nextElementSibling).toHaveTextContent('3')
    })

    it('says what an off pot does', async () => {
      mockApi(base({}, state({ jackpots: pots({ major: { live: false } }) })))
      renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      expect(box.getByRole('switch', { name: 'Major on' })).not.toBeChecked()
      expect(box.getByText('The pot is kept. Lost rounds add nothing and it cannot drop.')).toBeInTheDocument()
      expect(box.getAllByText('Lost rounds add to the pot.')).toHaveLength(2)
    })

    it('switches one pot off, sending all three with the saved caps and not what is typed', async () => {
      const fetchMock = mockApi(base({ 'PUT /gm/slots/jackpots': () => json(200, state({ jackpots: pots({ major: { live: false } }) })) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      await fill(user, box, 'Major', '9')
      await user.click(box.getByRole('switch', { name: 'Major on' }))

      await waitFor(() => expect(screen.getByRole('switch', { name: 'Major on' })).not.toBeChecked())
      expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpots')).toEqual([
        { mini: { live: true, cap: 1 }, major: { live: false, cap: 10 }, giga: { live: true, cap: 50 } },
      ])
    })

    it('saves all three caps at once, sending the saved switches', async () => {
      const fetchMock = mockApi(
        base({ 'PUT /gm/slots/jackpots': () => json(200, state({ jackpots: pots({ mini: { setCap: 2 }, major: { setCap: 20 }, giga: { setCap: 100 } }) })) }),
      )
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      await fill(user, box, 'Mini', '2')
      await fill(user, box, 'Major', '20')
      await fill(user, box, 'Giga', '100')
      await user.click(box.getByRole('button', { name: 'Save jackpots' }))

      await waitFor(() =>
        expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpots')).toEqual([
          { mini: { live: true, cap: 2 }, major: { live: true, cap: 20 }, giga: { live: true, cap: 100 } },
        ]),
      )
      await waitFor(() => expect(box.getByRole('spinbutton', { name: capField('Giga') })).toHaveValue(100))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it.each([
      ['Mini', '0', 'From 1 to 10,000 Gold'],
      ['Giga', '10001', 'From 1 to 10,000 Gold'],
      ['Major', '1.5', 'Enter a whole number'],
      ['Mini', 'abc', 'Enter a whole number'],
      ['Giga', '', 'Enter a whole number'],
    ])('does not send a %s cap of %j', async (name, typed, message) => {
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      await fill(user, box, name, typed)
      await user.click(box.getByRole('button', { name: 'Save jackpots' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(box.getByRole('spinbutton', { name: capField(name) })).toHaveAttribute('aria-invalid', 'true')
      expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpots')).toEqual([])
    })

    it.each([
      ['Mini', '10'],
      ['Mini', '20'],
      ['Giga', '10'],
      ['Giga', '5'],
    ])('does not send caps that do not rise, with %s set to %s', async (name, typed) => {
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      await fill(user, box, name, typed)
      await user.click(box.getByRole('button', { name: 'Save jackpots' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('The caps must rise: Mini below Major below Giga')
      expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpots')).toEqual([])
    })

    it('sends the edge caps 1 and 10000', async () => {
      const fetchMock = mockApi(base({ 'PUT /gm/slots/jackpots': () => json(200, state()) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      await fill(user, box, 'Major', '2')
      await fill(user, box, 'Giga', '10000')
      await user.click(box.getByRole('button', { name: 'Save jackpots' }))

      await waitFor(() =>
        expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpots')).toEqual([
          { mini: { live: true, cap: 1 }, major: { live: true, cap: 2 }, giga: { live: true, cap: 10_000 } },
        ]),
      )
    })

    it('shows the range the typed cap gives, and none while it is not a whole number in range', async () => {
      mockApi(base())
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      await fill(user, box, 'Giga', '80')
      expect(box.getByText('Can drop from 8 Gold, must drop before 80 Gold.')).toBeInTheDocument()
      await fill(user, box, 'Giga', '0')
      expect(box.queryByText(/Can drop from 8 Gold/)).not.toBeInTheDocument()
      expect(box.getAllByText(/Can drop from/)).toHaveLength(2)
    })

    it('shows both caps when the running jackpot keeps an older one', async () => {
      mockApi(base({}, state({ jackpots: pots({ giga: { setCap: 80, running: running(1000, 50_000) } }) })))
      renderRoute('/gm/slots', { me: gm })

      const giga = within((await jackpotsSection()).getByRole('region', { name: 'Giga' }))
      expect(giga.getByText('This jackpot must drop before 50 Gold. The next one: 80 Gold.')).toBeInTheDocument()
      expect(giga.queryByText('Must drop before 50 Gold.')).not.toBeInTheDocument()
    })

    it('says so when a pot cannot be read, and the switches and caps still work', async () => {
      const fetchMock = mockApi(base({ 'PUT /gm/slots/jackpots': () => json(200, state({ jackpots: pots({ mini: { live: false } }) })) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      expect(box.getAllByText("The jackpot's table is not in this database yet.")).toHaveLength(3)
      expect(box.queryByText('Pot now')).not.toBeInTheDocument()
      await user.click(box.getByRole('switch', { name: 'Mini on' }))
      await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpots')).toHaveLength(1))
      await fill(user, box, 'Giga', '70')
      await user.click(box.getByRole('button', { name: 'Save jackpots' }))
      await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/jackpots')).toHaveLength(2))
    })

    it("lists each pot's drops", async () => {
      const wins = [spin({ id: 9, at: '2026-11-14T09:05:00.000Z', character: 'Moosey', machine: 'hoard', stake: 200, payout: 50_000, jackpot: 50_000, pots: { mini: 0, major: 0, giga: 50_000 } })]
      mockApi(base({}, state({ jackpots: pots({ giga: { wins } }), latest: [] })))
      renderRoute('/gm/slots', { me: gm })

      const box = await jackpotsSection()
      const table = box.getByRole('table', { name: 'Giga drops' })
      expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['When', 'Character', 'Machine', 'Won'])
      expect(within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
        ['14 Nov, 09:05', 'Moosey', "Dragon's Hoard", '50 Gold'],
      ])
      expect(box.queryByRole('table', { name: 'Mini drops' })).not.toBeInTheDocument()
      expect(box.getAllByText('Nobody has won this jackpot yet.')).toHaveLength(2)
    })

    it('shows why a jackpot save failed', async () => {
      mockApi(base({ 'PUT /gm/slots/jackpots': () => json(403, { statusCode: 403, message: 'Not allowed' }) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      await user.click((await jackpotsSection()).getByRole('switch', { name: 'Giga on' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    })

    it('shows what a machine sent to the jackpot, and takes it out of the house result', async () => {
      const current = state()
      current.machines[1] = machine({ key: 'armoury', stakes: [40, 60, 100], today: { spins: 5, staked: 1000, paid: 900, added: 40 } })
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

  describe('daily limit', () => {
    const limitField = 'Rounds per account per day'
    const dailySection = () => section('Daily limit')

    it('shows the saved limit', async () => {
      mockApi(base())
      renderRoute('/gm/slots', { me: gm })

      expect((await dailySection()).getByRole('spinbutton', { name: limitField })).toHaveValue(1500)
    })

    it('saves a new limit', async () => {
      const fetchMock = mockApi(base({ 'PUT /gm/slots/daily': () => json(200, state({ daily: { limit: 2000 } })) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await dailySection()
      const field = box.getByRole('spinbutton', { name: limitField })
      await user.clear(field)
      await user.type(field, '2000')
      await user.click(box.getByRole('button', { name: 'Save limit' }))

      await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/daily')).toEqual([{ rounds: 2000 }]))
      await waitFor(() => expect(field).toHaveValue(2000))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it.each([
      ['99', 'From 100 to 10,000 rounds'],
      ['10001', 'From 100 to 10,000 rounds'],
      ['1.5', 'Enter a whole number'],
      ['', 'Enter a whole number'],
    ])('does not send a limit of %j', async (typed, message) => {
      const fetchMock = mockApi(base())
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await dailySection()
      const field = box.getByRole('spinbutton', { name: limitField })
      await user.clear(field)
      if (typed) await user.type(field, typed)
      await user.click(box.getByRole('button', { name: 'Save limit' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(sentBodies(fetchMock, 'PUT /gm/slots/daily')).toEqual([])
    })

    it('sends the edge limits 100 and 10000', async () => {
      const fetchMock = mockApi(base({ 'PUT /gm/slots/daily': () => json(200, state()) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      const box = await dailySection()
      const field = box.getByRole('spinbutton', { name: limitField })
      for (const [typed, count] of [
        ['100', 1],
        ['10000', 2],
      ] as const) {
        await user.clear(field)
        await user.type(field, typed)
        await user.click(box.getByRole('button', { name: 'Save limit' }))
        await waitFor(() => expect(sentBodies(fetchMock, 'PUT /gm/slots/daily')).toHaveLength(count))
      }
      expect(sentBodies(fetchMock, 'PUT /gm/slots/daily')).toEqual([{ rounds: 100 }, { rounds: 10_000 }])
    })

    it('shows why a save failed', async () => {
      mockApi(base({ 'PUT /gm/slots/daily': () => json(400, { statusCode: 400, message: 'Not allowed' }) }))
      const { user } = renderRoute('/gm/slots', { me: gm })

      await user.click((await dailySection()).getByRole('button', { name: 'Save limit' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
    })
  })
})
