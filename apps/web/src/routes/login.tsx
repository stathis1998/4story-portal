import { type LoginRequest, loginRequestSchema } from '@4story-portal/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { AuthCard, SubmitButton } from '../components/AuthCard'
import { FormMessage } from '../components/FormMessage'
import { TextField } from '../components/TextField'
import { applyServerError } from '../lib/form-errors'
import { meQueryOptions, useLogin } from '../lib/session'

export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQueryOptions)) throw redirect({ to: '/characters' })
  },
  component: LoginPage,
})

function LoginPage() {
  const login = useLogin()
  const [message, setMessage] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema), defaultValues: { username: '', password: '' } })

  const onSubmit = handleSubmit((values) => {
    setMessage(null)
    login.mutate(values, { onError: (error) => setMessage(applyServerError(error, setError)) })
  })

  return (
    <AuthCard title="Welcome back" subtitle="Log in with your game account.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormMessage message={message} />
        <TextField label="Username" registration={register('username')} error={errors.username?.message} autoComplete="username" />
        <TextField
          label="Password"
          type="password"
          registration={register('password')}
          error={errors.password?.message}
          autoComplete="current-password"
        />
        <SubmitButton pending={login.isPending} label="Log in" pendingLabel="Logging in…" />
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        No account yet?{' '}
        <Link to="/register" className="font-medium text-accent underline-offset-4 hover:underline">
          Register
        </Link>
      </p>
    </AuthCard>
  )
}
