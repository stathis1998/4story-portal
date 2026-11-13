import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AURAS, CHAKRAS } from '../lib/mounts-chakras'
import { mockApi } from '../test/mock-api'
import { clickNav } from '../test/nav'
import { renderRoute } from '../test/render-route'

// A 2D canvas doesn't exist in the test environment.
vi.mock('../components/chakras/ChakraPreview', () => ({
  ChakraPreview: ({ effect, tint, name }: { effect: string; tint: string | null; name: string }) => (
    <div role="img" aria-label={`Preview of ${name}`} data-effect={effect} data-tint={tint ?? ''} />
  ),
}))

const me = { userId: 1, username: 'friend', isGm: false }

const open = async () => {
  mockApi()
  renderRoute('/chakras-auras', { me })
  await screen.findByRole('heading', { name: 'Chakras & Auras', level: 1 })
}

describe('chakras and auras page', () => {
  it('is linked from the header', async () => {
    mockApi()
    const { user, router } = renderRoute('/characters', { me })

    await clickNav(user, 'Tools', 'Chakras & Auras')

    await waitFor(() => expect(router.state.location.pathname).toBe('/chakras-auras'))
    expect(await screen.findByRole('heading', { name: 'Chakras & Auras', level: 1 })).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/chakras-auras', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('lists every chakra', async () => {
    await open()

    const list = screen.getByRole('list', { name: 'Chakras' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(CHAKRAS.length)
    expect(CHAKRAS).toHaveLength(10)
    expect(within(list).getByText('Violet Chakra')).toBeInTheDocument()
  })

  it('previews the chakra you pick, in its colour', async () => {
    mockApi()
    const { user } = renderRoute('/chakras-auras', { me })
    await screen.findByRole('heading', { name: 'Chakras & Auras', level: 1 })
    const preview = screen.getByRole('complementary', { name: 'Chakra preview' })
    expect(within(preview).getByRole('img', { name: `Preview of ${CHAKRAS[0].name}` })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Red Chakra' }))

    expect(within(preview).getByRole('img', { name: 'Preview of Red Chakra' })).toHaveAttribute('data-tint', '#ff1a1a')
    expect(screen.getByRole('button', { name: 'Red Chakra', pressed: true })).toBeInTheDocument()
  })

  it('lists the auras beside the chakras and previews the one you pick', async () => {
    mockApi()
    const { user } = renderRoute('/chakras-auras', { me })
    await screen.findByRole('heading', { name: 'Chakras & Auras', level: 1 })
    expect(within(screen.getByRole('list', { name: 'Auras' })).getAllByRole('listitem')).toHaveLength(AURAS.length)

    await user.click(screen.getByRole('button', { name: 'Dark Aura' }))

    const preview = screen.getByRole('complementary', { name: 'Aura preview' })
    expect(within(preview).getByRole('img', { name: 'Preview of Dark Aura' })).toHaveAttribute('data-effect', 'darkAura')
    expect(within(screen.getByRole('complementary', { name: 'Chakra preview' })).getByRole('img', { name: `Preview of ${CHAKRAS[0].name}` })).toBeInTheDocument()
  })
})
