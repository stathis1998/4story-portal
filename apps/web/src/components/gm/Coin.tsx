import { GameIcon } from './GameIcon'

type Props = { spriteId: number; alt?: string }

// Column 0 of the Rune and Luna sprites is a strip bled in from the texture atlas, so it is clipped off.
export const Coin = ({ spriteId, alt }: Props) => (
  <GameIcon spriteId={spriteId} size={16} alt={alt} className="[clip-path:inset(0_0_0_12%)]" />
)
