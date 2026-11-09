import { useId } from 'react'

export function Total({ name, value }: { name: string; value: number }) {
  const id = useId()

  return (
    <div>
      <dt id={id} className="text-xs font-bold tracking-wider text-muted uppercase">
        {name}
      </dt>
      <dd aria-labelledby={id} className="text-xl font-bold">
        {value.toLocaleString('en-US')}
      </dd>
    </div>
  )
}
