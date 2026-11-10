import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
        audience: 'names',
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

  it('drops delivered recipients so a resend only reaches the failures', async () => {
    const fetchMock = mockApi({
      'POST /gm/mail': () =>
        json(200, {
          results: [
            { name: 'Moose', postId: 1000 },
            { name: 'Kael', postId: null, error: 'Send failed, check the mailbox before resending' },
          ],
        }),
    })
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.type(await screen.findByLabelText('Recipients'), 'Moose,Kael{Enter}')
    await user.type(screen.getByLabelText('Title'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    await screen.findByText('Moose: sent (post 1000)')
    expect(screen.queryByRole('button', { name: 'Remove Moose' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Kael' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(sentBodies(fetchMock, 'POST /gm/mail')).toHaveLength(2))
    expect((sentBodies(fetchMock, 'POST /gm/mail')[1] as { recipients: string[] }).recipients).toEqual(['Kael'])
  })

  it('sends once when Confirm is double-clicked', async () => {
    const fetchMock = mockApi({ 'POST /gm/mail': () => json(200, { results: [{ name: 'Moose', postId: 1000 }] }) })
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.type(await screen.findByLabelText('Recipients'), 'Moose{Enter}')
    await user.type(screen.getByLabelText('Title'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    // Two clicks in the same tick, before React re-renders the disabled state.
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' })
    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)
    await screen.findByText('Moose: sent (post 1000)')
    expect(sentBodies(fetchMock, 'POST /gm/mail')).toHaveLength(1)
  })

  it('marks the recipients the server did not find', async () => {
    mockApi({ 'POST /gm/mail': () => json(422, { statusCode: 422, message: 'Unknown characters: Ghost' }) })
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.type(await screen.findByLabelText('Recipients'), 'Moose,Ghost{Enter}')
    await user.type(screen.getByLabelText('Title'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('button', { name: 'Remove Ghost (not found)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Moose' })).toBeInTheDocument()
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

describe('GM mail page: picking recipients', () => {
  const chars = [
    { charId: 2, name: 'Kael', level: 40, className: 'Warrior', online: true },
    { charId: 1, name: 'Moose', level: 50, className: 'Mage', online: false },
  ]
  const characters = { 'GET /gm/characters': () => json(200, chars) }

  it('filters characters by search and adds one by clicking', async () => {
    mockApi(characters)
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.type(await screen.findByLabelText('Recipients'), 'mo')
    const list = await screen.findByRole('list', { name: 'Matching characters' })
    expect(within(list).queryByRole('button', { name: /Kael/ })).not.toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: /Moose/ }))
    expect(screen.getByRole('button', { name: 'Remove Moose' })).toBeInTheDocument()
    expect(screen.getByLabelText('Recipients')).toHaveValue('')
  })

  it('adds the top match on Enter', async () => {
    mockApi(characters)
    const { user } = renderRoute('/gm/mail', { me: gm })
    await screen.findByRole('tab', { name: 'All characters (2)' })
    await user.type(screen.getByLabelText('Recipients'), 'ka{Enter}')
    expect(screen.getByRole('button', { name: 'Remove Kael' })).toBeInTheDocument()
  })

  it('shows the online and all counts on the tabs', async () => {
    mockApi(characters)
    renderRoute('/gm/mail', { me: gm })
    expect(await screen.findByRole('tab', { name: 'Everyone online (1)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All characters (2)' })).toBeInTheDocument()
  })

  it('sends to all characters after confirming the count', async () => {
    const fetchMock = mockApi({
      ...characters,
      'POST /gm/mail': () => json(200, { results: [{ name: 'Kael', postId: 1000 }, { name: 'Moose', postId: 1001 }] }),
    })
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.click(await screen.findByRole('tab', { name: 'All characters (2)' }))
    await user.type(screen.getByLabelText('Title'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send this mail?' })
    expect(dialog).toHaveTextContent('This sends 2 letters')
    expect(dialog).toHaveTextContent('Kael, Moose')
    await user.click(within(dialog).getByRole('button', { name: 'Send 2 letters' }))
    expect(await screen.findByText('Kael: sent (post 1000)')).toBeInTheDocument()
    expect(sentBodies(fetchMock, 'POST /gm/mail')).toEqual([
      {
        audience: 'all',
        recipients: [],
        sender: '[GM]',
        title: 'Hi',
        message: '',
        money: { gold: 0, silver: 0, copper: 0 },
        items: [],
      },
    ])
  })

  it('goes back to names with only the failures after a bulk send', async () => {
    mockApi({
      ...characters,
      'POST /gm/mail': () =>
        json(200, {
          results: [
            { name: 'Kael', postId: null, error: 'Send failed, check the mailbox before resending' },
            { name: 'Moose', postId: 1001 },
          ],
        }),
    })
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.click(await screen.findByRole('tab', { name: 'All characters (2)' }))
    await user.type(screen.getByLabelText('Title'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(await screen.findByRole('button', { name: 'Send 2 letters' }))
    await screen.findByText('Moose: sent (post 1001)')
    expect(screen.getByRole('tab', { name: 'Choose names' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Remove Kael' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Moose' })).not.toBeInTheDocument()
  })

  it('refuses to send to online when nobody is online', async () => {
    mockApi({ 'GET /gm/characters': () => json(200, chars.map((c) => ({ ...c, online: false }))) })
    const { user } = renderRoute('/gm/mail', { me: gm })
    await user.click(await screen.findByRole('tab', { name: 'Everyone online (0)' }))
    expect(screen.getByText('No one is online right now.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Title'), 'Hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No one is online right now.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
