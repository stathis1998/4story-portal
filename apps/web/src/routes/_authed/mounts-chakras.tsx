import { createFileRoute, redirect } from '@tanstack/react-router'

// The old Mounts & Chakras page, split into Mounts & Pets and Chakras & Auras. Old links land on the mounts.
export const Route = createFileRoute('/_authed/mounts-chakras')({
  beforeLoad: () => {
    throw redirect({ to: '/mounts-pets', replace: true })
  },
})
