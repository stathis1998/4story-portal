import type { GradeLayer, WeaponEffectsData, WeaponSearchResult } from '@4story-portal/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { json, mockApi } from '../test/mock-api'
import { clickNav } from '../test/nav'
import { renderRoute } from '../test/render-route'

vi.mock('../components/weapons/WeaponViewer', () => ({
  default: ({ itemId, skinId, layer, name }: { itemId: number; skinId: number | null; layer: GradeLayer | null; name: string }) => (
    <div data-testid="viewer">{`${name} model ${itemId} skin ${skinId ?? 'none'} layer ${layer ? `${layer.texture}/${layer.op}` : 'none'}`}</div>
  ),
}))

const me = { userId: 1, username: 'friend', isGm: false }

const layer = (texture: number, op: GradeLayer['op'], swatch = '#123456'): GradeLayer => ({ texture, op, keys: [], loopMs: 0, swatch })

const effects: WeaponEffectsData = {
  layers: {
    '1:2': layer(1089472, 19),
    '1:4': layer(1089471, 5),
    '1:5': layer(1089473, 6, '#a65f3a'),
    '1:52': layer(30016, 6),
  },
}

const sword: WeaponSearchResult = { itemId: 7625, name: 'Sword of Dawn', kind: 1, level: 85, icon: null }

const routes = (overrides = {}) => ({
  'GET /weapon-effects': () => json(200, effects),
  'GET /weapon-effects/weapons/7625': () => json(200, sword),
  'GET /weapon-effects/weapons?q=dawn': () => json(200, [sword]),
  ...overrides,
})

const viewer = () => screen.findByTestId('viewer')

describe('weapon effects page', () => {
  it('is linked from the header', async () => {
    mockApi(routes())
    const { user, router } = renderRoute('/characters', { me })

    await clickNav(user, 'Tools', 'Weapon Effects')

    await waitFor(() => expect(router.state.location.pathname).toBe('/weapon-effects'))
    expect(await screen.findByRole('heading', { name: 'Weapon Effects', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Pick a weapon to see it in 3D.')).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/weapon-effects', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('finds a weapon by name and shows it', async () => {
    mockApi(routes())
    const { user, router } = renderRoute('/weapon-effects', { me })

    await user.type(await screen.findByLabelText('Find a weapon'), 'dawn')
    await user.click(await screen.findByRole('button', { name: /Sword of Dawn/ }))

    await waitFor(() => expect(router.state.location.search).toMatchObject({ item: 7625 }))
    expect(await viewer()).toHaveTextContent('Sword of Dawn model 7625 skin none')
  })

  it('lists every effect from +17, with game names and the client quirks', async () => {
    mockApi(routes())
    renderRoute('/weapon-effects?item=7625&level=17&effect=1', { me })

    const chips = within(await screen.findByRole('group', { name: 'Effects' })).getAllByRole('button')
    expect(chips).toHaveLength(39)
    expect(screen.getByRole('button', { name: /Storm Blue/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Effect 19/ })).toHaveTextContent('No visible effect on weapons in game.')
    expect(screen.getByRole('button', { name: /Sea/ })).toHaveAttribute('aria-pressed', 'true')
    expect(await viewer()).toHaveTextContent('layer 1089471/5')
  })

  it('switches the effect, keeping it in the address', async () => {
    mockApi(routes())
    const { user, router } = renderRoute('/weapon-effects?item=7625&level=23&effect=1', { me })

    await user.click(await screen.findByRole('button', { name: /Fire/ }))

    await waitFor(() => expect(router.state.location.search).toMatchObject({ item: 7625, level: 23, effect: 2 }))
    expect(await viewer()).toHaveTextContent('layer 1089473/6')
    expect(screen.getByText('+23')).toBeInTheDocument()
  })

  it('shows no effect choice below +17, only the tier', async () => {
    mockApi(routes())
    renderRoute('/weapon-effects?item=7625&level=12', { me })

    expect(await screen.findByText(/\+11 to \+15/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Effects' })).not.toBeInTheDocument()
    expect(await viewer()).toHaveTextContent('layer 1089472/19')
  })

  it('draws no layer for an effect the game shows nothing for', async () => {
    mockApi(routes())
    renderRoute('/weapon-effects?item=7625&level=20&effect=19', { me })

    expect(await viewer()).toHaveTextContent('layer none')
  })

  it('keeps odd address values inside the game limits', async () => {
    mockApi(routes())
    renderRoute('/weapon-effects?item=7625&level=99&effect=0', { me })

    expect(await screen.findByText('+24')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sea/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('passes a skin on to the viewer', async () => {
    mockApi(routes())
    renderRoute('/weapon-effects?item=7625&level=17&effect=2&skin=9001', { me })

    expect(await viewer()).toHaveTextContent('skin 9001')
  })

  it('says so when previews are not available', async () => {
    mockApi(routes({ 'GET /weapon-effects': () => json(503, { message: 'Weapon previews are not available' }) }))
    renderRoute('/weapon-effects?item=7625', { me })

    expect(await screen.findByText('Weapon previews are not available right now.')).toBeInTheDocument()
  })
})
