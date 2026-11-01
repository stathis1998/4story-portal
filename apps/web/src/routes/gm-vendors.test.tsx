import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }
const player = { userId: 2, username: 'plain', isGm: false }

const vendor = (overrides = {}) => ({
  id: 20002,
  name: 'Mr Bab',
  title: 'Trader',
  shop: 'money',
  country: 'Defugel',
  mapId: 0,
  mapName: 'Overworld',
  itemCount: 10,
  faceIcon: 6480,
  ...overrides,
})
const list = (vendors: unknown[], database = 'TGAME_GSP') => () => json(200, { database, vendors })

const dorosi = vendor({ id: 20001, name: 'Mrs Dorosi', title: 'Consumer goods', faceIcon: 6481 })
const pvp = vendor({ id: 20003, name: 'Elrod', title: 'Honor', shop: 'pvp', faceIcon: null })

describe('vendors page', () => {
  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/vendors', { me: player })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it('is reachable from the GM nav', async () => {
    mockApi({
      'GET /gm/logins': () => json(200, []),
      'GET /gm/status': () => json(200, { state: 'connected', worlds: [], channels: [] }),
      'GET /gm/vendors': list([vendor()]),
    })
    const { user } = renderRoute('/gm/logins', { me: gm })
    await user.click(await screen.findByRole('link', { name: 'Vendors' }))
    expect(await screen.findByRole('heading', { name: 'Vendors' })).toBeInTheDocument()
  })

  it('warns when editing a test copy', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor()], 'TGAME_GSP_TEST') })
    renderRoute('/gm/vendors', { me: gm })
    expect(await screen.findByText("Editing TGAME_GSP_TEST. Players won't see this test copy.")).toBeInTheDocument()
    expect(screen.getByText('Changes reach players after TMapSvr restarts.')).toBeInTheDocument()
  })

  it('shows only the restart line on the live database', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor()]) })
    renderRoute('/gm/vendors', { me: gm })
    expect(await screen.findByText('Changes reach players after TMapSvr restarts.')).toBeInTheDocument()
    expect(screen.queryByText(/Players won't see/)).not.toBeInTheDocument()
  })

  it('filters as you type on name, title and id', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor(), dorosi, pvp]) })
    const { user } = renderRoute('/gm/vendors', { me: gm })
    const search = await screen.findByLabelText('Search vendors')
    await user.type(search, 'dorosi')
    expect(screen.getByRole('button', { name: /Mrs Dorosi/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mr Bab/ })).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'honor')
    expect(screen.getByRole('button', { name: /Elrod/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dorosi/ })).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, '20002')
    expect(screen.getByRole('button', { name: /Mr Bab/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Elrod/ })).not.toBeInTheDocument()
  })

  it('filters to PvP shops', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor(), pvp]) })
    const { user } = renderRoute('/gm/vendors', { me: gm })
    await user.click(await screen.findByLabelText('PvP shops only'))
    expect(screen.getByRole('button', { name: /Elrod/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mr Bab/ })).not.toBeInTheDocument()
  })

  it('shows the portrait, and a placeholder when there is none or it fails to load', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor(), pvp]) })
    renderRoute('/gm/vendors', { me: gm })
    const bab = await screen.findByRole('button', { name: /Mr Bab/ })
    const img = bab.querySelector('img')!
    expect(img).toHaveAttribute('src', '/game-icons/6480.png')
    expect(img).toHaveAttribute('loading', 'lazy')

    const elrod = screen.getByRole('button', { name: /Elrod/ })
    expect(elrod.querySelector('img')).toBeNull()
    expect(elrod.querySelector('[aria-hidden="true"]')).not.toBeNull()

    fireEvent.error(img)
    expect(bab.querySelector('img')).toBeNull()
    expect(bab.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('falls back to the title for a vendor with no name', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor({ name: '' })]) })
    renderRoute('/gm/vendors', { me: gm })
    expect(await screen.findByRole('button', { name: /Trader/ })).toBeInTheDocument()
  })

  it('falls back to NPC id for a vendor with no name or title', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor({ name: '', title: '' })]) })
    renderRoute('/gm/vendors', { me: gm })
    expect(await screen.findByRole('button', { name: /NPC 20002/ })).toBeInTheDocument()
  })

  it('selects a vendor into the URL and keeps it on load', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor(), dorosi]) })
    const { user, router } = renderRoute('/gm/vendors', { me: gm })
    expect(await screen.findByText('Pick a vendor to see what they sell.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Mrs Dorosi/ }))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ vendor: 20001 }))
    expect(await screen.findByRole('heading', { name: 'Mrs Dorosi' })).toBeInTheDocument()
  })

  it('opens the vendor named in the URL', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor(), dorosi]) })
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    expect(await screen.findByRole('heading', { name: 'Mr Bab' })).toBeInTheDocument()
    expect(screen.getByText(/Trader · Defugel · Overworld/)).toBeInTheDocument()
  })

  it('says when a linked vendor does not exist', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor()]) })
    renderRoute('/gm/vendors?vendor=30000', { me: gm })
    expect(await screen.findByText('That NPC is not a vendor.')).toBeInTheDocument()
  })

  it('ignores a garbage vendor param', async () => {
    mockApi({ 'GET /gm/vendors': list([vendor()]) })
    renderRoute('/gm/vendors?vendor=abc', { me: gm })
    expect(await screen.findByText('Pick a vendor to see what they sell.')).toBeInTheDocument()
    expect(screen.queryByText('That NPC is not a vendor.')).not.toBeInTheDocument()
  })

  it('says when vendors cannot load', async () => {
    mockApi({ 'GET /gm/vendors': () => json(400, { message: 'nope' }) })
    renderRoute('/gm/vendors', { me: gm })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load vendors.')
  })
})

const item = (o = {}) => ({
  itemId: 8001,
  name: 'Small Potion',
  level: 1,
  icon: 500,
  base: 1,
  multiplier: 50,
  price: 50,
  soldBy: 12,
  ...o,
})

const stockApi = (items: unknown[], extra: Parameters<typeof mockApi>[0] = {}) =>
  mockApi({
    'GET /gm/vendors': list([vendor(), pvp]),
    'GET /gm/vendors/20002/items': () => json(200, items),
    'GET /gm/vendors/20003/items': () => json(200, items),
    ...extra,
  })

type User = ReturnType<typeof renderRoute>['user']

const openEditor = async (user: User, name = 'Small Potion') =>
  user.click(await screen.findByRole('button', { name: `Edit price of ${name}` }))

const setField = async (user: User, label: string, value: string) => {
  const field = screen.getByLabelText(label)
  await user.clear(field)
  if (value) await user.type(field, value)
}

const deleted = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([input]) => String(input))

describe('vendor stock', () => {
  it('lists stock with icon, level, split price and sold-by', async () => {
    stockApi([item(), item({ itemId: 8002, name: 'Derion Cloth', price: 5000, soldBy: 3, icon: null })])
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    const row = (await screen.findByText('Small Potion')).closest('tr')!
    expect(row.querySelector('img')).toHaveAttribute('src', '/game-icons/500.png')
    expect(within(row).getByTestId('price')).toHaveTextContent('50')
    expect(within(row).getByRole('img', { name: 'Cron' })).toBeInTheDocument()
    expect(within(row).getByText('12')).toBeInTheDocument()
    expect(within(screen.getByText('Derion Cloth').closest('tr')!).getByTestId('price')).toHaveTextContent('5')
  })

  it('filters stock', async () => {
    stockApi([item(), item({ itemId: 8002, name: 'Derion Cloth' })])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await user.type(await screen.findByLabelText('Filter stock'), 'cloth')
    expect(screen.getByText('Derion Cloth')).toBeInTheDocument()
    expect(screen.queryByText('Small Potion')).not.toBeInTheDocument()
  })

  it('shows Free for a price of 0', async () => {
    stockApi([item({ price: 0, multiplier: 0 })])
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    expect(await screen.findByText('Free')).toBeInTheDocument()
  })

  it('shows points for a PvP shop', async () => {
    stockApi([item({ price: 150 })])
    renderRoute('/gm/vendors?vendor=20003', { me: gm })
    expect(await screen.findByText('150 points')).toBeInTheDocument()
  })

  it('shows an unknown item, removable, with no edit button', async () => {
    stockApi([item({ name: null })])
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    expect(await screen.findByText('Unknown item #8001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit price/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Unknown item #8001' })).toBeInTheDocument()
  })

  it('shows no edit button when the base is 0', async () => {
    stockApi([item({ base: 0 })])
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    expect(await screen.findByText("Price can't be set: level 0 item")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit price/ })).not.toBeInTheDocument()
  })

  it('previews sell-back and warns about other vendors', async () => {
    stockApi([item()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await setField(user, 'Cron', '75')
    const sells = screen.getByText(/Sells back for/)
    expect(sells).toHaveTextContent('Sells back for 18')
    expect(within(sells).getByRole('img', { name: 'Cron' })).toBeInTheDocument()
    expect(screen.getByText('Sold by 12 vendors: this changes all of them.')).toBeInTheDocument()
  })

  it('leaves out the vendor warning when only this vendor sells it', async () => {
    stockApi([item({ soldBy: 1 })])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    expect(screen.getByText(/Sells back for/)).toHaveTextContent('Sells back for 12')
    expect(screen.queryByText(/this changes all of them/)).not.toBeInTheDocument()
  })

  it('disables save until the price changes', async () => {
    stockApi([item()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await setField(user, 'Cron', '75')
    expect(save).toBeEnabled()
    await setField(user, 'Cron', '50')
    expect(save).toBeDisabled()
  })

  it('sends the joined amount and shows a note', async () => {
    const fetchMock = stockApi([item()], {
      'PUT /gm/items/8001/price': () =>
        json(200, { itemId: 8001, name: 'Small Potion', price: 1_002_003, multiplier: 1, soldBy: 12 }),
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await setField(user, 'Rune', '1')
    await setField(user, 'Luna', '2')
    await setField(user, 'Cron', '3')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(sentBodies(fetchMock, 'PUT /gm/items/8001/price')).toEqual([{ currency: 'money', amount: 1_002_003 }]),
    )
    expect(
      await screen.findByText(/now costs 1 Rune 2 Luna 3 Cron at 12 vendors\. Restart TMapSvr to apply\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('says 1 vendor when singular', async () => {
    stockApi([item()], {
      'PUT /gm/items/8001/price': () =>
        json(200, { itemId: 8001, name: 'Small Potion', price: 75, multiplier: 75, soldBy: 1 }),
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await setField(user, 'Cron', '75')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Small Potion now costs 75 Cron at 1 vendor. Restart TMapSvr to apply.'),
    ).toBeInTheDocument()
  })

  it('edits one points field and hides sell-back on a PvP shop', async () => {
    const fetchMock = stockApi([item({ price: 150 })], {
      'PUT /gm/items/8001/price': () =>
        json(200, { itemId: 8001, name: 'Small Potion', price: 200, multiplier: 200, soldBy: 12 }),
    })
    const { user } = renderRoute('/gm/vendors?vendor=20003', { me: gm })
    await openEditor(user)
    expect(screen.queryByLabelText('Rune')).not.toBeInTheDocument()
    expect(screen.queryByText(/Sells back/)).not.toBeInTheDocument()
    await setField(user, 'PvP points', '200')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(sentBodies(fetchMock, 'PUT /gm/items/8001/price')).toEqual([{ currency: 'pvp', amount: 200 }]),
    )
    expect(await screen.findByText(/now costs 200 points at 12 vendors/)).toBeInTheDocument()
  })

  it('treats a blank field as 0', async () => {
    const fetchMock = stockApi([item()], {
      'PUT /gm/items/8001/price': () =>
        json(200, { itemId: 8001, name: 'Small Potion', price: 1_000_000, multiplier: 1, soldBy: 12 }),
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await setField(user, 'Cron', '')
    await setField(user, 'Rune', '1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(sentBodies(fetchMock, 'PUT /gm/items/8001/price')).toEqual([{ currency: 'money', amount: 1_000_000 }]),
    )
  })

  it('disables save for a negative or fractional value', async () => {
    stockApi([item()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    const save = screen.getByRole('button', { name: 'Save' })
    await setField(user, 'Cron', '-5')
    expect(save).toBeDisabled()
    await setField(user, 'Cron', '7.5')
    expect(save).toBeDisabled()
    await setField(user, 'Cron', '60')
    expect(save).toBeEnabled()
  })

  it('warns when the price cannot be charged exactly', async () => {
    stockApi([item({ base: 53750, price: 0, multiplier: 0 })])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await setField(user, 'Rune', '16')
    const charge = screen.getByText(/Will charge/)
    expect(charge).toHaveTextContent('Will charge 15999999')
    expect(within(charge).getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual(['Rune', 'Luna', 'Cron'])
    expect(screen.getByText(/Sells back for/)).toHaveTextContent('Sells back for 3999999')
    await setField(user, 'Rune', '0')
    await setField(user, 'Cron', '75')
    expect(screen.queryByText(/Will charge/)).not.toBeInTheDocument()
  })

  it('keeps the typed values and shows the error when saving fails', async () => {
    stockApi([item()], {
      'PUT /gm/items/8001/price': () => json(422, { statusCode: 422, message: 'Price is too high for this item' }),
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await setField(user, 'Cron', '75')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Price is too high for this item')).toBeInTheDocument()
    expect(screen.getByLabelText('Cron')).toHaveValue(75)
  })

  it('closes the editor when another vendor is selected', async () => {
    stockApi([item()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await user.click(screen.getByRole('button', { name: /Elrod/ }))
    expect(await screen.findByRole('heading', { name: 'Elrod' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Edit price of Small Potion' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('asks before removing and sends nothing on cancel', async () => {
    const fetchMock = stockApi([item()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await user.click(await screen.findByRole('button', { name: 'Remove Small Potion' }))
    expect(screen.getByText('Remove Small Potion from Mr Bab?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Remove Small Potion from Mr Bab?')).not.toBeInTheDocument()
    expect(deleted(fetchMock)).toEqual([])
  })

  it('removes and shows a note', async () => {
    let removed = false
    const fetchMock = stockApi([], {
      'GET /gm/vendors/20002/items': () => json(200, removed ? [] : [item()]),
      'DELETE /gm/vendors/20002/items/8001': () => {
        removed = true
        return json(200, { itemId: 8001, name: 'Small Potion' })
      },
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await user.click(await screen.findByRole('button', { name: 'Remove Small Potion' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Small Potion removed from Mr Bab. Restart TMapSvr to apply.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Small Potion' })).not.toBeInTheDocument())
    expect(deleted(fetchMock)).toEqual(['/api/gm/vendors/20002/items/8001'])
  })

  it('refreshes after removing an item that was already gone', async () => {
    let gone = false
    const fetchMock = stockApi([], {
      'GET /gm/vendors/20002/items': () => json(200, gone ? [] : [item()]),
      'DELETE /gm/vendors/20002/items/8001': () => {
        gone = true
        return json(404, { statusCode: 404, message: 'That vendor no longer sells this item' })
      },
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await user.click(await screen.findByRole('button', { name: 'Remove Small Potion' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('That vendor no longer sells this item')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Small Potion')).not.toBeInTheDocument())
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input) === '/api/gm/vendors/20002/items').length,
    ).toBeGreaterThan(1)
  })
})

describe('coin prices', () => {
  const priceCell = async (name: string) =>
    within((await screen.findByText(name)).closest('tr')!).getByTestId('price')

  it('shows only non-zero denominations with their coins', async () => {
    stockApi([item({ price: 5_200 })])
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    const cell = await priceCell('Small Potion')
    expect(cell).toHaveTextContent('5200')
    expect(within(cell).getByRole('img', { name: 'Luna' })).toHaveAttribute('src', '/game-icons/11138.png')
    expect(within(cell).getByRole('img', { name: 'Cron' })).toHaveAttribute('src', '/game-icons/11136.png')
    expect(within(cell).queryByRole('img', { name: 'Rune' })).not.toBeInTheDocument()
  })

  it('shows all three coins for a price with all three', async () => {
    stockApi([item({ price: 1_002_003 })])
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    const cell = await priceCell('Small Potion')
    expect(cell).toHaveTextContent('123')
    expect(within(cell).getByRole('img', { name: 'Rune' })).toHaveAttribute('src', '/game-icons/11137.png')
    expect(within(cell).getByRole('img', { name: 'Luna' })).toBeInTheDocument()
    expect(within(cell).getByRole('img', { name: 'Cron' })).toBeInTheDocument()
  })

  it('uses no coins for a PvP price', async () => {
    stockApi([item({ price: 1_200 })])
    renderRoute('/gm/vendors?vendor=20003', { me: gm })
    const cell = await priceCell('Small Potion')
    expect(cell).toHaveTextContent('1,200 points')
    expect(within(cell).queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows Free with no coins for 0', async () => {
    stockApi([item({ price: 0 })])
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    const cell = await priceCell('Small Potion')
    expect(cell).toHaveTextContent('Free')
    expect(within(cell).queryByRole('img')).not.toBeInTheDocument()
  })

  it('says a free sell-back is nothing', async () => {
    stockApi([item({ base: 3, price: 3 })])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    expect(screen.getByText('Sells back for nothing.')).toBeInTheDocument()
  })

  it('puts a coin next to each editor label', async () => {
    stockApi([item()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    for (const label of ['Rune', 'Luna', 'Cron']) {
      expect(screen.getByText(label).closest('label')!.querySelector('img')).toHaveAttribute('alt', '')
    }
  })

  it('words the save note and says when an item becomes free', async () => {
    stockApi([item()], {
      'PUT /gm/items/8001/price': () =>
        json(200, { itemId: 8001, name: 'Small Potion', price: 0, multiplier: 0, soldBy: 12 }),
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await setField(user, 'Cron', '')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Small Potion is now free at 12 vendors. Restart TMapSvr to apply.'),
    ).toBeInTheDocument()
  })
})

describe('stock table states', () => {
  it('clips the atlas sliver off every coin', async () => {
    stockApi([item({ price: 1_002_003 })])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    const row = (await screen.findByText('Small Potion')).closest('tr')!
    for (const img of within(row.querySelector('[data-testid="price"]') as HTMLElement).getAllByRole('img')) {
      expect(img.className).toContain('clip-path')
    }
    await openEditor(user)
    expect(screen.getByText('Rune').closest('label')!.querySelector('img')!.className).toContain('clip-path')
  })

  it('explains a price above the maximum', async () => {
    stockApi([item()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openEditor(user)
    await setField(user, 'Rune', '123456')
    expect(screen.getByText('Too high: the most a price can be is 4,294 Rune 967 Luna 295 Cron.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByText(/Sells back/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Will charge/)).not.toBeInTheDocument()
  })

  it('says an empty shop sells nothing and still allows adding', async () => {
    stockApi([])
    renderRoute('/gm/vendors?vendor=20002', { me: gm })
    expect(await screen.findByText('This vendor sells nothing yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add item' })).toBeInTheDocument()
  })

  it('says when the filter matches nothing', async () => {
    stockApi([item()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await user.type(await screen.findByLabelText('Filter stock'), 'zzz')
    expect(screen.getByText('No matching items.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

const found = (o = {}) => ({
  itemId: 8001,
  name: 'Small Potion',
  level: 1,
  icon: 500,
  price: 50,
  pvpPrice: 150,
  inClient: true,
  ...o,
})

const searchApi = (results: unknown[], extra: Parameters<typeof mockApi>[0] = {}) =>
  stockApi([item({ itemId: 9000, name: 'Old Sword' })], {
    'GET /gm/items?q=potion': () => json(200, results),
    ...extra,
  })

const openSearch = async (user: User, text = 'potion') => {
  await user.click(await screen.findByRole('button', { name: '+ Add item' }))
  await user.type(screen.getByLabelText('Find an item'), text)
}

describe('adding items', () => {
  it('opens from + Add item and searches as you type', async () => {
    const fetchMock = searchApi([found()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    expect(screen.queryByLabelText('Find an item')).not.toBeInTheDocument()
    await openSearch(user)
    expect(await screen.findByRole('button', { name: /^Small Potion/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/gm/items?q='))).toHaveLength(1)
  })

  it('encodes the search text', async () => {
    const fetchMock = searchApi([], { 'GET /gm/items?q=a%26b': () => json(200, []) })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user, 'a&b')
    await waitFor(() => expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain('/api/gm/items?q=a%26b'))
  })

  it('shows icon, name, id, level and the price for this shop', async () => {
    searchApi([found()])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user)
    const result = await screen.findByRole('button', { name: /^Small Potion/ })
    expect(result.querySelector('img')).toHaveAttribute('src', '/game-icons/500.png')
    expect(result).toHaveTextContent('#8001')
    expect(result).toHaveTextContent('Lv 1')
    expect(within(result).getByRole('img', { name: 'Cron' })).toBeInTheDocument()
  })

  it('shows the points price on a PvP shop', async () => {
    searchApi([found()])
    const { user } = renderRoute('/gm/vendors?vendor=20003', { me: gm })
    await openSearch(user)
    expect(await screen.findByRole('button', { name: /^Small Potion/ })).toHaveTextContent('150 points')
  })

  it('adds on click and shows a note', async () => {
    let added = false
    const fetchMock = searchApi([found()], {
      'GET /gm/vendors/20002/items': () => json(200, added ? [item({ itemId: 9000, name: 'Old Sword' }), item()] : [item({ itemId: 9000, name: 'Old Sword' })]),
      'POST /gm/vendors/20002/items': () => {
        added = true
        return json(201, item())
      },
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user)
    await user.click(await screen.findByRole('button', { name: /^Small Potion/ }))
    expect(await screen.findByText('Small Potion added to Mr Bab. Restart TMapSvr to apply.')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /gm/vendors/20002/items')).toEqual([{ itemId: 8001 }])
    expect(await screen.findByRole('button', { name: 'Remove Small Potion' })).toBeInTheDocument()
  })

  it('says a newly added item is free', async () => {
    searchApi([found()], { 'POST /gm/vendors/20002/items': () => json(201, item({ price: 0 })) })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user)
    await user.click(await screen.findByRole('button', { name: /^Small Potion/ }))
    expect(
      await screen.findByText(
        'Small Potion added to Mr Bab. Restart TMapSvr to apply. It is free in this shop until you set a price.',
      ),
    ).toBeInTheDocument()
  })

  it('greys out items already sold', async () => {
    searchApi([found({ itemId: 9000, name: 'Old Sword' })])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user)
    const result = await screen.findByRole('button', { name: /^Old Sword/ })
    expect(result).toBeDisabled()
    expect(result).toHaveTextContent('Already sold')
  })

  it('greys out items not in the client', async () => {
    searchApi([found({ inClient: false })])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user)
    const result = await screen.findByRole('button', { name: /^Small Potion/ })
    expect(result).toBeDisabled()
    expect(result).toHaveTextContent('Not in client')
  })

  it('shows the error when adding fails', async () => {
    searchApi([found()], {
      'POST /gm/vendors/20002/items': () => json(422, { statusCode: 422, message: 'This shop is full' }),
    })
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user)
    await user.click(await screen.findByRole('button', { name: /^Small Potion/ }))
    expect(await screen.findByText('This shop is full')).toBeInTheDocument()
  })

  it('says when nothing matches', async () => {
    searchApi([])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user)
    expect(await screen.findByText('No matching items.')).toBeInTheDocument()
  })

  it('does not search for a blank query', async () => {
    const fetchMock = searchApi([])
    const { user } = renderRoute('/gm/vendors?vendor=20002', { me: gm })
    await openSearch(user, '  ')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/gm/items?q='))).toBe(false)
  })
})
