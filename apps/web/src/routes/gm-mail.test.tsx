import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

const gm = { userId: 1, username: 'moose', isGm: true }
const player = { userId: 2, username: 'plain', isGm: false }

const found = (itemId: number, name: string, stack = 20) => ({
  itemId, name, level: 1, icon: null, stack, base: 0, multiplier: 0, price: 0, soldBy: 0, inClient: true, canSellBack: true,
})
const results = [found(51, 'Small Potion'), found(52, 'Big Potion'), found(53, 'Huge Potion')]
const search = { 'GET /gm/items?q=pot&shop=money': () => json(200, results) }

type User = ReturnType<typeof renderRoute>['user']

async function addItem(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: 'Add item' }))
  await user.type(screen.getByLabelText('Find an item'), 'pot')
  await user.click(await screen.findByRole('button', { name: new RegExp(name) }))
}

describe('GM mail page', () => {
  it('sends a non-GM to /characters', async () => {
    mockApi()
    const { router } = renderRoute('/gm/mail', { me: player })
    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })

  it('adds and removes recipient chips', async () => {
    mockApi()
    const { user } = renderRoute('/gm/mail', { me: gm })
    const input = await screen.findByLabelText('Recipients')
    await user.type(input, 'Moose,')
    await user.type(input, 'Kael{Enter}')
    expect(screen.getByRole('button', { name: 'Remove Moose' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Kael' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Moose' }))
    expect(screen.queryByRole('button', { name: 'Remove Moose' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Kael' })).toBeInTheDocument()
  })

  it('hides Add item after three items', async () => {
    mockApi(search)
    const { user } = renderRoute('/gm/mail', { me: gm })
    await screen.findByLabelText('Recipients')
    await addItem(user, 'Small Potion')
    await addItem(user, 'Big Potion')
    await addItem(user, 'Huge Potion')
    expect(screen.getAllByRole('spinbutton', { name: /^Count for/ })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument()
  })

  it('confirms before sending, then shows results', async () => {
    const fetchMock = mockApi({
      ...search,
      'POST /gm/mail': () => json(200, { results: [{ name: 'Moose', postId: 1000 }] }),
    })
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.type(await screen.findByLabelText('Recipients'), 'Moose{Enter}')
    await user.type(screen.getByLabelText('Title'), 'Hi')
    await addItem(user, 'Small Potion')
    const count = screen.getByRole('spinbutton', { name: 'Count for Small Potion' })
    await user.clear(count)
    await user.type(count, '2')
    await user.clear(screen.getByLabelText('Rune'))
    await user.type(screen.getByLabelText('Rune'), '5')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    const dialog = await screen.findByRole('dialog', { name: 'Send this mail?' })
    expect(dialog).toHaveTextContent('Moose')
    expect(dialog).toHaveTextContent('Small Potion x2')
    expect(dialog).toHaveTextContent('5 Rune')
    expect(sentBodies(fetchMock, 'POST /gm/mail')).toEqual([])

    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Moose: sent (post 1000)')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /gm/mail')).toEqual([
      {
        recipients: ['Moose'],
        sender: '[GM]',
        title: 'Hi',
        message: '',
        money: { gold: 5, silver: 0, copper: 0 },
        items: [{ itemId: 51, count: 2 }],
      },
    ])
  })

  it("shows the API's 422 message", async () => {
    mockApi({ 'POST /gm/mail': () => json(422, { statusCode: 422, message: 'Unknown characters: Ghost' }) })
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.type(await screen.findByLabelText('Recipients'), 'Ghost{Enter}')
    await user.type(screen.getByLabelText('Title'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Unknown characters: Ghost')).toBeInTheDocument()
  })

  it('shows a validation problem instead of confirming', async () => {
    mockApi()
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.type(await screen.findByLabelText('Title'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add at least one recipient')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
