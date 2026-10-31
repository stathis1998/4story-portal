export function FormMessage({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger-surface px-3 py-2 text-sm text-danger">
      {message}
    </div>
  )
}
