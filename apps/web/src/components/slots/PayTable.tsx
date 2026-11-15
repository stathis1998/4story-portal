import {
  SLOT_LINE_COUNT,
  SLOT_PAYING,
  SLOT_SCATTER,
  SLOT_WILD,
  silverText,
  slotFreeRate,
  slotJackpotShare,
  slotLargestWin,
  slotLostRate,
  slotMeterRate,
  slotPaysRate,
  slotReturn,
} from "@4story-portal/shared";
import type { SlotMachine, SlotStakes } from "@4story-portal/shared";
import { GameIcon } from "../gm/GameIcon";
import { LineMap } from "./WinLines";

type PayTableProps = {
  machine: SlotMachine;
  stake: number;
  stakes: SlotStakes;
  jackpotLive: boolean;
};

/** A prize is in line stakes: money is the prize x the stake / SLOT_LINE_COUNT. */
const money = (prize: number, stake: number) =>
  silverText((prize * stake) / SLOT_LINE_COUNT);

function SymbolName({
  machine,
  symbol,
}: {
  machine: SlotMachine;
  symbol: number;
}) {
  const { name, sprite } = machine.symbols[symbol];
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="shrink-0">
        <GameIcon
          spriteId={sprite}
          size={32}
          className="[image-rendering:pixelated]"
        />
      </span>
      <span className="font-bold">{name}</span>
    </span>
  );
}

/** Everything a player reads under the machine: what each symbol pays, the lines, and the counted figures. */
export function PayTable({
  machine,
  stake,
  stakes,
  jackpotLive,
}: PayTableProps) {
  // Top prize first.
  const order = Array.from({ length: SLOT_PAYING }, (_, i) => i).sort(
    (a, b) => machine.pays[b][2] - machine.pays[a][2],
  );
  const scatter = machine.symbols[SLOT_SCATTER].name;
  const share = slotJackpotShare(machine);
  const total =
    slotReturn(machine) + (slotLostRate(machine) * share.num) / share.den;

  return (
    <div className="space-y-4 text-sm">
      <table className="w-full text-left">
        <thead>
          <tr className="text-muted">
            <th scope="col" className="py-1 pr-2 font-bold">
              Symbol
            </th>
            {[3, 4, 5].map((n) => (
              <th key={n} scope="col" className="py-1 pr-2 font-bold">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((symbol) => (
            <tr key={symbol} className="border-t border-line">
              <th scope="row" className="py-2 pr-2 text-left font-normal">
                <SymbolName machine={machine} symbol={symbol} />
                {symbol === 0 && (
                  <span className="mt-1 block text-xs text-muted">
                    Two from the left: {money(machine.twoLucky, stake)}
                  </span>
                )}
              </th>
              {machine.pays[symbol].map((prize, k) => (
                // Free to wrap: on a phone '6 Gold 250 Silver' would push the table past the screen's edge.
                <td key={k} className="py-2 pr-2 font-bold tabular-nums">
                  {money(prize, stake)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-1">
        <SymbolName machine={machine} symbol={SLOT_WILD} />
        <p>{`Stands in for any symbol on a line, except the ${scatter}. Only on reels 2, 3 and 4.`}</p>
      </div>
      <div className="space-y-1">
        <SymbolName machine={machine} symbol={SLOT_SCATTER} />
        <p>
          3, 4 or 5 anywhere give 8, 12 or 20 free spins. Every win in a free
          spin is doubled.
        </p>
      </div>

      <p>
        20 win lines, all in play on every spin. A line pays from the left reel.
      </p>
      <LineMap />

      <p>
        Cascades: winning symbols burst and new ones fall in from above. Each
        win in a row pays more: x1, x2, x3, x4, then x5.
      </p>
      <p>
        Free spins: 3, 4 or 5 scatters give 8, 12 or 20. The multiplier starts
        at x2 and climbs with every win, up to x10. 3 scatters during free spins
        add 5 more, up to 50.
      </p>
      <p>{`Meter: every scatter that does not win free spins fills it. At ${machine.meterSize} it pays 8 free spins. One meter for each machine and stake.`}</p>
      <p>
        Jackpots: every lost round feeds the Mini, the Major and the Giga. Each
        must drop before its cap.
      </p>

      <p>{`This machine pays back ${(total * 100).toFixed(1)}% of what goes into it over time, counting the meter and the jackpots. A short session can pay back less, and the meter only pays when it fills.`}</p>
      <p>{`One round in ${Math.round(1 / slotPaysRate(machine))} pays something.`}</p>
      <p>{`Free spins come about once in ${Math.round(1 / slotFreeRate(machine))} rounds; the meter fills about once every ${Math.round(1 / slotMeterRate(machine))}.`}</p>
      <p>{`The most one paid spin can win at these stakes is ${silverText(slotLargestWin(machine, stakes))}. A round with free spins can win more.`}</p>
      {jackpotLive && (
        <p>{`A lost round adds ${((share.num / share.den) * 100).toFixed(1)}% of its stake to the jackpots.`}</p>
      )}
    </div>
  );
}
