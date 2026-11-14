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
      className="w-full min-w-0 rounded-xs sm:min-w-28 border border-line bg-surface-raised px-2 py-1 text-sm outline-none pointer-coarse:text-base transition focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
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

// On a phone a level is two lines instead of one wide row: the level, its scroll and Serendipity, then the chance and
// the Tincture. The roles are spelled out because a table laid out as a grid can lose them in the browser.
const ROW = 'max-sm:grid max-sm:grid-cols-[3rem_minmax(0,1fr)_5.5rem] max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-1.5 max-sm:px-1.5 max-sm:py-2'
const CELL = 'px-2 py-1.5 max-sm:p-0'

/** One row of scroll, Serendipity and Tincture per level an item can be upgraded from. */
export function StrategyTable({ register, rows, current, onChange }: Props) {
  return (
    <div className="overflow-x-auto">
      <table role="table" className="w-full text-left text-sm max-sm:block">
        <thead role="rowgroup" className="max-sm:sr-only">
          <tr role="row">
            {HEADINGS.map((heading) => (
              <th key={heading} role="columnheader" scope="col" className="px-2 pb-2 text-xs font-bold tracking-wider text-muted uppercase">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-sm:block">
          {rows.map((row, level) => (
            <tr
              key={level}
              role="row"
              aria-current={level === current ? 'true' : undefined}
              className={`border-t border-line aria-[current]:bg-surface-raised ${ROW}`}
            >
              <th role="rowheader" scope="row" className={`font-bold ${CELL}`}>
                +{level}
              </th>
              <td role="cell" className={CELL}>
                <CellSelect
                  label={`Scroll at +${level}`}
                  registration={register(`rows.${level}.scroll`, { onChange })}
                  options={SCROLLS.map((scroll) => ({ ...scroll, disabled: !canAttempt(level, scroll.value) }))}
                />
              </td>
              <td role="cell" className={CELL}>
                <CellSelect
                  label={`Serendipity at +${level}`}
                  registration={register(`rows.${level}.potion`, { valueAsNumber: true, onChange })}
                  options={[...POTIONS]}
                  disabled={row.scroll === 'reflection'}
                />
              </td>
              <td role="cell" className={`max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2 ${CELL}`}>
                <CellSelect
                  label={`Tincture at +${level}`}
                  registration={register(`rows.${level}.tincture`, { onChange })}
                  options={[...TINCTURES]}
                  disabled={row.scroll === 'reflection'}
                />
              </td>
              <td role="cell" className={`font-bold text-accent-text max-sm:col-start-1 max-sm:row-start-2 ${CELL}`}>
                {row.scroll === 'reflection' ? `to +${level - 1}` : `${upgradeChance(level, row.potion)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
