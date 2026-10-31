import { createFileRoute, redirect } from '@tanstack/react-router'
import { meQueryOptions } from '../lib/session'

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    throw redirect({ to: me ? '/characters' : '/login' })
  },
})
