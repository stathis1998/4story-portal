import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { themeAtom } from '../lib/theme'

export type RouterContext = { queryClient: QueryClient }

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RootError,
})

function RootLayout() {
  const theme = useAtomValue(themeAtom)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return <Outlet />
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl text-accent">Lost in the wilds</h1>
      <p className="text-muted">This page does not exist.</p>
      <Link to="/" className="font-medium text-accent underline-offset-4 hover:underline">
        Back home
      </Link>
    </main>
  )
}

function RootError() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl text-danger">Something went wrong</h1>
      <p className="text-muted">The page hit an unexpected error.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg hover:bg-accent-hover"
      >
        Reload
      </button>
    </main>
  )
}
