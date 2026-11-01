import { useState } from 'react'

type Props = { spriteId: number | null; size: number; alt?: string; className?: string }

export function GameIcon({ spriteId, size, alt = '', className = '' }: Props) {
  const [failed, setFailed] = useState(false)
  if (spriteId === null || failed) {
    return <span aria-hidden="true" className="inline-block shrink-0 rounded-xs bg-line" style={{ width: size, height: size }} />
  }
  return (
    <img
      src={`/game-icons/${spriteId}.png`}
      alt={alt}
      loading="lazy"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-xs ${className}`}
    />
  )
}
