import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CHAKRAS, MOUNTS } from '../lib/mounts-chakras'
import { mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

const open = async () => {
  mockApi()
  renderRoute('/mounts-chakras', { me })
  await screen.findByRole('heading', { name: 'Mounts & Chakras', level: 1 })
}

describe('mounts and chakras page', () => {
  it('is linked from the header', async () => {
    mockApi()
    const { user, router } = renderRoute('/characters', { me })

    await user.click(await screen.findByRole('link', { name: 'Mounts & Chakras' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/mounts-chakras'))
    expect(await screen.findByRole('heading', { name: 'Mounts & Chakras', level: 1 })).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/mounts-chakras', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('lists every chakra', async () => {
    await open()

    const list = screen.getByRole('list', { name: 'Chakras' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(CHAKRAS.length)
    expect(CHAKRAS).toHaveLength(10)
    expect(within(list).getByText('Violet Chakra')).toBeInTheDocument()
  })

  it('lists every mount once, with the durations it comes in', async () => {
    await open()

    const list = screen.getByRole('list', { name: 'Mounts' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(MOUNTS.length)
    expect(within(list).getAllByText('Black Buffalo')).toHaveLength(1)

    const blackBuffalo = within(list).getByText('Black Buffalo').closest('li') as HTMLElement
    expect(blackBuffalo).toHaveTextContent('Permanent')
    expect(blackBuffalo).toHaveTextContent('30 days')
  })

  it('shows the item icon when there is one', async () => {
    await open()

    const withIcon = MOUNTS.find((mount) => mount.icon !== null)
    const row = within(screen.getByRole('list', { name: 'Mounts' })).getByText(withIcon!.name).closest('li') as HTMLElement
    expect(row.querySelector('img')).toHaveAttribute('src', `/game-icons/${withIcon!.icon}.png`)
  })
})
