import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const me = { userId: 1, username: 'friend', isGm: false }

const buyButtons = () => screen.findAllByRole('button', { name: /^Buy / })

describe('shop page', () => {
  it('opens from the main menu', async () => {
    mockApi()
    const { router, user } = renderRoute('/characters', { me })

    await user.click(await screen.findByRole('link', { name: 'Shop' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/shop'))
    expect(await screen.findByRole('heading', { name: 'Shop', level: 1 })).toBeInTheDocument()
  })

  it('sends visitors who are not logged in to the login page', async () => {
    mockApi()
    const { router } = renderRoute('/shop', { me: null })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('offers four Gold packs and says nothing until one is bought', async () => {
    mockApi()
    renderRoute('/shop', { me })

    expect(await buyButtons()).toHaveLength(4)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('answers each pack with its own message, replacing the last one', async () => {
    mockApi()
    const { user } = renderRoute('/shop', { me })

    const messages: (string | null)[] = []
    for (const button of await buyButtons()) {
      await user.click(button)
      messages.push(screen.getByRole('status').textContent)
    }

    expect(messages.every(Boolean)).toBe(true)
    expect(new Set(messages).size).toBe(4)
  })

  it('never contacts the server', async () => {
    const fetchMock = mockApi()
    const { user } = renderRoute('/shop', { me })

    for (const button of await buyButtons()) await user.click(button)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
