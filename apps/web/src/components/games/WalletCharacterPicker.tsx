import { COIN_SPRITES } from '@4story-portal/shared'
import type { Wallet, WalletCharacter } from '@4story-portal/shared'
import { Coin } from '../gm/Coin'

type PickerProps = {
  id: string
  label: string
  characters: WalletCharacter[]
  /** The chosen character, or null when none can play. */
  value: number | null
  disabled?: boolean
  onChange: (id: number) => void
}

const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'

/**
 * Picks the character whose money is at stake. Every character is listed, but one in the game cannot be
 * picked: the game would save over its wallet.
 */
export function WalletCharacterPicker({ id, label, characters, value, disabled = false, onChange }: PickerProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelText}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled || value === null}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-11 w-full min-w-0 rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {value === null && <option value="">{characters.length === 0 ? 'No characters' : 'Nobody is free to play'}</option>}
        {characters.map((character) => (
          <option key={character.id} value={character.id} disabled={character.online}>
            {character.online
              ? `${character.name} (in the game, log out to play)`
              : `${character.name} (level ${character.level} ${character.className})`}
          </option>
        ))}
      </select>
    </div>
  )
}

const COINS = [
  ['gold', 'Gold', COIN_SPRITES.gold],
  ['silver', 'Silver', COIN_SPRITES.silver],
  ['copper', 'Bronze', COIN_SPRITES.bronze],
] as const

/** A wallet the way the game shows money: each coin that is not zero, with its sprite. An empty wallet reads 0 Silver. */
export function WalletCoins({ wallet }: { wallet: Wallet }) {
  const shown = COINS.filter(([key]) => wallet[key] > 0)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-bold tabular-nums">
      {(shown.length > 0 ? shown : COINS.slice(1, 2)).map(([key, name, sprite]) => (
        <span key={key} className="inline-flex items-center gap-0.5 whitespace-nowrap">
          {wallet[key].toLocaleString('en-US')}
          <Coin spriteId={sprite} alt={name} />
        </span>
      ))}
    </span>
  )
}
