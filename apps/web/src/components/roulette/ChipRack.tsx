import { silverText } from '@4story-portal/shared'
import { useId } from 'react'

type RackProps = { chips: number[]; value: number; disabled: boolean; onChange: (chip: number) => void }

// Casino colours by value, kept clear of the felt's red, black and green. Light chips get dark print.
const CHIP_COLOURS: [number, string, string][] = [
  [5000, '#17736a', '#f4efe8'],
  [1000, '#2b2424', '#e9c46a'],
  [500, '#c9973a', '#1c1410'],
  [100, '#6f4c9b', '#f4efe8'],
  [50, '#276c96', '#f4efe8'],
  [0, '#e4ddd3', '#1c1410'],
]

/** A chip's face: 10 Silver reads '10', 1 Gold '1G', 1 Gold 500 Silver '1.5G'. The exact amount is in the label. */
function chipFace(silver: number): string {
  if (silver < 1000) return String(silver)
  const gold = silver / 1000
  return `${gold >= 100 ? Math.floor(gold) : Math.floor(gold * 10) / 10}G`
}

type DiscProps = { amount: number; size: 'rack' | 'felt' }

/** A round chip with a dashed edge; its colour is that of the largest standard chip in the amount. */
export function ChipDisc({ amount, size }: DiscProps) {
  const [, fill, print] = CHIP_COLOURS.find(([from]) => amount >= from) ?? CHIP_COLOURS[CHIP_COLOURS.length - 1]
  const box = size === 'rack' ? 'h-11 w-11 border-[3px] text-xs' : 'h-7 w-7 border-2 text-[0.6rem] shadow-[0_1px_2px_rgb(0_0_0/0.7)]'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-dashed border-white/75 font-bold leading-none tabular-nums ${box}`}
      style={{ backgroundColor: fill, color: print }}
    >
      {chipFace(amount)}
    </span>
  )
}

/** The chips a player can put down, one chosen at a time. */
export function ChipRack({ chips, value, disabled, onChange }: RackProps) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label="Chip" className="flex flex-wrap gap-1.5 pt-1">
      {chips.map((chip) => (
        <label key={chip} className={`relative rounded-full ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
          <input
            type="radio"
            name={name}
            value={chip}
            aria-label={silverText(chip)}
            checked={chip === value}
            disabled={disabled}
            onChange={() => onChange(chip)}
            className="peer sr-only"
          />
          <span className="block rounded-full transition peer-checked:-translate-y-1 peer-checked:ring-2 peer-checked:ring-fg peer-checked:ring-offset-2 peer-checked:ring-offset-surface peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent-text">
            <ChipDisc amount={chip} size="rack" />
          </span>
        </label>
      ))}
    </div>
  )
}
