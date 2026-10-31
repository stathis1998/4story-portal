import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi, sentBodies } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

async function fillForm(user: ReturnType<typeof renderRoute>['user'], confirm = 'secret1') {
  await user.type(await screen.findByLabelText('Username'), 'newuser')
  await user.type(screen.getByLabelText('Password'), 'secret1')
  await user.type(screen.getByLabelText('Confirm password'), confirm)
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('/register', () => {
  it('shows a mismatch under confirm password', async () => {
    mockApi()
    const { user } = renderRoute('/register', { me: null })

    await fillForm(user, 'secret2')

    expect(await screen.findByText('Passwords do not match')).toHaveAttribute('id', 'confirmPassword-error')
  })

  it('shows a taken username under the username field', async () => {
    mockApi({ 'POST /auth/register': () => json(409, { statusCode: 409, message: 'Username is already taken' }) })
    const { user } = renderRoute('/register', { me: null })

    await fillForm(user)

    expect(await screen.findByText('Username is already taken')).toHaveAttribute('id', 'username-error')
  })

  it('shows a rate limit in the message box', async () => {
    mockApi({
      'POST /auth/register': () =>
        json(429, { statusCode: 429, message: 'Too many attempts. Please try again later.' }),
    })
    const { user } = renderRoute('/register', { me: null })

    await fillForm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please try again later.')
  })

  it('sends only username and password', async () => {
    const fetchMock = mockApi({ 'POST /auth/register': () => json(201, { userId: 5, username: 'newuser' }) })
    const { user } = renderRoute('/register', { me: null })

    await fillForm(user)

    await screen.findByRole('heading', { name: 'Your characters' })
    expect(sentBodies(fetchMock, 'POST /auth/register')).toEqual([{ username: 'newuser', password: 'secret1' }])
  })
})
