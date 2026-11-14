import type { UseFormRegister, UseFormRegisterReturn } from 'react-hook-form'
import type { PriceCoins } from '../../lib/upgrade-prices'
import { canAttempt, POTIONS, SCROLLS, TINCTURES, upgradeChance, type UpgradeChoices } from '../../lib/upgrade-simulator'

export type UpgradeForm = UpgradeChoices & { start: number; target: number; perLevel: boolean; rows: UpgradeChoices[]; prices: PriceCoins }

type Option = { value: string | number; label: string; disabled?: boolean }
type Props = {
  register: UseFormRegister<UpgradeForm>
  rows: UpgradeChoices[]
  /** The level the item is at now, or undefined when there is no item to upgrade. */
  current?: number
  onChange: () => void
}

type CellProps = { label: string; registration: UseFormRegisterReturn; options: Option[]; disabled?: boolean }

function CellSelect({ label, registration, options, disabled }: CellProps) {
  return (
    <select
      aria-label={label}
      disabled={disabled}
      className="w-full min-w-28 rounded-xs border border-line bg-surface-raised px-2 py-1 text-sm outline-none transition focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      {...registration}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

const HEADINGS = ['Level', 'Scroll', 'Serendipity', 'Tincture', 'Chance']

/** One row of scroll, Serendipity and Tincture per level an item can be upgraded from. */
export function StrategyTable({ register, rows, current, onChange }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {HEADINGS.map((heading) => (
              <th key={heading} scope="col" className="px-2 pb-2 text-xs font-bold tracking-wider text-muted uppercase">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, level) => (
            <tr key={level} aria-current={level === current ? 'true' : undefined} className="border-t border-line aria-[current]:bg-surface-raised">
              <th scope="row" className="px-2 py-1.5 font-bold">
                +{level}
              </th>
              <td className="px-2 py-1.5">
                <CellSelect
                  label={`Scroll at +${level}`}
                  registration={register(`rows.${level}.scroll`, { onChange })}
                  options={SCROLLS.map((scroll) => ({ ...scroll, disabled: !canAttempt(level, scroll.value) }))}
                />
              </td>
              <td className="px-2 py-1.5">
                <CellSelect
                  label={`Serendipity at +${level}`}
                  registration={register(`rows.${level}.potion`, { valueAsNumber: true, onChange })}
                  options={[...POTIONS]}
                  disabled={row.scroll === 'reflection'}
                />
              </td>
              <td className="px-2 py-1.5">
                <CellSelect
                  label={`Tincture at +${level}`}
                  registration={register(`rows.${level}.tincture`, { onChange })}
                  options={[...TINCTURES]}
                  disabled={row.scroll === 'reflection'}
                />
              </td>
              <td className="px-2 py-1.5 font-bold text-accent-text">
                {row.scroll === 'reflection' ? `to +${level - 1}` : `${upgradeChance(level, row.potion)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
