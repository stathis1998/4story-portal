import { COIN_SPRITES } from '@4story-portal/shared'
import type { UseFormRegister } from 'react-hook-form'
import { PRICE_FIELDS } from '../../lib/upgrade-prices'
import { Coin } from '../gm/Coin'
import type { UpgradeForm } from './StrategyTable'

type Props = { register: UseFormRegister<UpgradeForm>; onChange: () => void }

const COINS = [
  { key: 'rune', label: 'Rune', sprite: COIN_SPRITES.rune },
  { key: 'luna', label: 'Luna', sprite: COIN_SPRITES.luna },
  { key: 'cron', label: 'Cron', sprite: COIN_SPRITES.cron },
] as const

/**
 * What each upgrade item costs, in the game's three coins as on the GM mail page. On a phone an item is its name with the
 * three fields under it, each marked with its coin. The roles are spelled out because a table laid out as a grid can lose them.
 */
export function PriceFields({ register, onChange }: Props) {
  return (
    <div className="overflow-x-auto">
      <table role="table" className="text-left text-sm max-sm:block">
        <thead role="rowgroup" className="max-sm:sr-only">
          <tr role="row">
            <th role="columnheader" scope="col" className="px-2 pb-2 text-xs font-bold tracking-wider text-muted uppercase">
              Item
            </th>
            {COINS.map(({ key, label, sprite }) => (
              <th key={key} role="columnheader" scope="col" className="px-2 pb-2 text-xs font-bold tracking-wider text-muted uppercase">
                <span className="inline-flex items-center gap-1.5">
                  <Coin spriteId={sprite} />
                  {label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-sm:block">
          {PRICE_FIELDS.map((item) => (
            <tr key={item.key} role="row" className="border-t border-line max-sm:grid max-sm:grid-cols-3 max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-2">
              <th role="rowheader" scope="row" className="px-2 py-1.5 font-bold max-sm:col-span-3 max-sm:p-0">
                {item.label}
              </th>
              {COINS.map((coin) => (
                <td key={coin.key} role="cell" className="px-2 py-1.5 max-sm:flex max-sm:items-center max-sm:gap-1.5 max-sm:p-0">
                  {/* The column headings are off screen on a phone, so the coin sits beside its field. The field's label names it. */}
                  <span className="flex sm:hidden">
                    <Coin spriteId={coin.sprite} />
                  </span>
                  <input
                    type="number"
                    min={0}
                    aria-label={`${item.label} ${coin.label}`}
                    className="w-24 rounded-xs border max-sm:w-full max-sm:min-w-0 border-line bg-surface-raised px-2 py-1 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
                    {...register(`prices.${item.key}.${coin.key}`, { valueAsNumber: true, onChange })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
