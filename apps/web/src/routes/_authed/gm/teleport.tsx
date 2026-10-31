import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { StatusBadge } from '../../../components/StatusBadge'
import { gmStatusQueryOptions } from '../../../lib/gm'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/teleport')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: TeleportPage,
})

function TeleportPage() {
  const { data: status } = useQuery(gmStatusQueryOptions)

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Teleport</h1>
        {status && <StatusBadge state={status.state} />}
      </div>
    </main>
  )
}
