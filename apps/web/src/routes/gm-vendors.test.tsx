import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi } from '../test/mock-api'
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
