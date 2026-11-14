import { silverText } from '@4story-portal/shared'
import type { SlotMachine } from '@4story-portal/shared'
import { GameIcon } from '../gm/GameIcon'

type PayTableProps = { machine: SlotMachine; stake: number }

type Prize = { symbol: number; count: 2 | 3; line: string; multiple: number }

/** Three of each symbol, top prize first, then two lucky symbols from the left. */
function prizesOf(machine: SlotMachine): Prize[] {
  const threes = machine.symbols.map(
    (symbol, i): Prize => ({ symbol: i, count: 3, line: `Three ${symbol.plural}`, multiple: machine.pays[i] }),
  )
  return [
    ...threes.sort((a, b) => b.multiple - a.multiple),
    { symbol: 0, count: 2, line: `Two ${machine.symbols[0].plural} from the left`, multiple: machine.twoLucky },
  ]
}

/** The machine's payout table, drawn with its icons, each prize as a multiple of the stake and as money at `stake`. */
export function PayTable({ machine, stake }: PayTableProps) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-muted">
          <th className="py-1 pr-2 font-bold">On the line</th>
          <th className="py-1 pr-2 font-bold">Pays</th>
          <th className="py-1 text-right font-bold">At {silverText(stake)}</th>
        </tr>
      </thead>
      <tbody>
        {prizesOf(machine).map((prize) => (
          <tr key={`${prize.count}-${prize.symbol}`} className="border-t border-line">
            <td className="py-2 pr-2">
              <span aria-hidden="true" className="flex gap-1">
                {Array.from({ length: 3 }, (_, i) =>
                  i < prize.count ? (
                    <GameIcon key={i} spriteId={machine.symbols[prize.symbol].sprite} size={32} className="[image-rendering:pixelated]" />
                  ) : (
                    // Anything at all on the third reel.
                    <span key={i} className="inline-block h-8 w-8 shrink-0 rounded-xs border border-dashed border-line" />
                  ),
                )}
              </span>
              <span className="mt-1 block text-xs text-muted">{prize.line}</span>
            </td>
            <td className="py-2 pr-2 whitespace-nowrap">pays {prize.multiple} times</td>
            {/* Free to wrap: on a phone '6 Gold 250 Silver' would push the table past the screen's edge. */}
            <td className="py-2 text-right font-bold tabular-nums">{silverText(prize.multiple * stake)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
