import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/characters')({
  component: CharactersPage,
})

function CharactersPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl">Your characters</h1>
    </main>
  )
}
