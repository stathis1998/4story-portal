import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { Button } from '../components/Button'

export type RouterContext = { queryClient: QueryClient }

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: RootError,
})

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl text-accent-text">Lost in the wilds</h1>
      <p className="text-muted">This page does not exist.</p>
      <Link to="/" className="font-bold text-accent-text underline-offset-4 hover:underline">
        Back home
      </Link>
    </main>
  )
}

function RootError() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl text-danger">Something went wrong</h1>
      <p className="text-muted">The page hit an unexpected error.</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </main>
  )
}
