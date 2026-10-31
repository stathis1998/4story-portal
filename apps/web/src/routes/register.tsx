import { type RegisterForm, registerFormSchema } from '@4story-portal/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { AuthCard, SubmitButton } from '../components/AuthCard'
import { FormMessage } from '../components/FormMessage'
import { TextField } from '../components/TextField'
import { applyServerError } from '../lib/form-errors'
import { meQueryOptions, useRegister } from '../lib/session'

export const Route = createFileRoute('/register')({
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQueryOptions)) throw redirect({ to: '/characters' })
  },
  component: RegisterPage,
})

function RegisterPage() {
  const registerAccount = useRegister()
  const [message, setMessage] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { username: '', password: '', confirmPassword: '' },
  })

  const onSubmit = handleSubmit((values) => {
    setMessage(null)
    registerAccount.mutate(values, {
      onError: (error) => setMessage(applyServerError(error, setError, { conflictField: 'username' })),
    })
  })

  return (
    <AuthCard title="Create your account" subtitle="One account for the portal and the game.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormMessage message={message} />
        <TextField label="Username" registration={register('username')} error={errors.username?.message} autoComplete="username" />
        <TextField
          label="Password"
          type="password"
          registration={register('password')}
          error={errors.password?.message}
          autoComplete="new-password"
        />
        <TextField
          label="Confirm password"
          type="password"
          registration={register('confirmPassword')}
          error={errors.confirmPassword?.message}
          autoComplete="new-password"
        />
        <SubmitButton pending={registerAccount.isPending} label="Create account" pendingLabel="Creating account…" />
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </AuthCard>
  )
}
