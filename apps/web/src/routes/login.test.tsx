import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { json, mockApi } from '../test/mock-api'
import { renderRoute } from '../test/render-route'

describe('/login', () => {
  it('shows schema errors when submitted empty', async () => {
    mockApi()
    const { user } = renderRoute('/login', { me: null })

    await user.click(await screen.findByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Enter your username')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
  })

  it('shows a 401 in the message box above the form', async () => {
    mockApi({ 'POST /auth/login': () => json(401, { statusCode: 401, message: 'Invalid username or password' }) })
    const { user } = renderRoute('/login', { me: null })

    await user.type(await screen.findByLabelText('Username'), 'moose')
    await user.type(screen.getByLabelText('Password'), 'wrong12')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password')
  })

  it('disables the submit button while the request is pending', async () => {
    mockApi({ 'POST /auth/login': () => new Promise<Response>(() => {}) })
    const { user } = renderRoute('/login', { me: null })

    await user.type(await screen.findByLabelText('Username'), 'moose')
    await user.type(screen.getByLabelText('Password'), 'secret1')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Logging in/ })).toBeDisabled())
  })

  it('goes to /characters after a successful login', async () => {
    mockApi({ 'POST /auth/login': () => json(200, { userId: 1, username: 'moose', isGm: false }) })
    const { user, router } = renderRoute('/login', { me: null })

    await user.type(await screen.findByLabelText('Username'), 'moose')
    await user.type(screen.getByLabelText('Password'), 'secret1')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/characters'))
  })
})
