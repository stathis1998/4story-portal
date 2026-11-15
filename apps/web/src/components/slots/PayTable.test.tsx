import {
  SLOT_MACHINES,
  silverText,
  slotFreeRate,
  slotJackpotShare,
  slotLostRate,
  slotMeterRate,
  slotPaysRate,
  slotReturn,
} from "@4story-portal/shared";
import type { SlotMachine } from "@4story-portal/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { showing } from "../../test/slot-fixture";
import { PayTable } from "./PayTable";

const base = showing(["GHGHG", "HGHGH", "GHGHG"]);
// 1,000 windows; one window in five wins one step, at 10 line stakes each.
const steps = new Array(26 * 12).fill(0);
steps[2 * 12] = 2000;
const machine: SlotMachine = {
  ...base,
  counts: {
    last: [700, 100, 50, 50, 50, 50],
    blankLast: [400, 60, 30, 10, 10, 10],
    free: new Array(26).fill(0),
    steps,
    best: 4000,
    longest: 1,
    capped: 0,
  },
};
const stakes: [number, number, number] = [20, 40, 60];

describe("the pay table", () => {
  it("lists the paying symbols top prize first, with prizes as money at the stake", () => {
    render(
      <PayTable machine={machine} stake={40} stakes={stakes} jackpotLive />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    expect(
      rows.map((row) => within(row).getAllByRole("rowheader")[0].textContent),
    ).toEqual([
      "Hotel",
      "Golf",
      "Foxtrot",
      "Echo",
      "Delta",
      "Charlie",
      "Bravo",
      "Alpha" + "Two from the left: 4 Silver",
    ]);
    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual(["Symbol", "3", "4", "5"]);
    // Symbol 7: [40, 160, 800] line stakes at a line stake of 2 Silver.
    const hotel = within(rows[0])
      .getAllByRole("cell")
      .map((td) => td.textContent);
    expect(hotel).toEqual([
      silverText(40 * 2),
      silverText(160 * 2),
      silverText(800 * 2),
    ]);
    expect(hotel[2]).toBe("1 Gold 600 Silver");
  });

  it("names the wild and the scatter and what they do", () => {
    render(
      <PayTable machine={machine} stake={40} stakes={stakes} jackpotLive />,
    );
    expect(
      screen.getByText(
        "Stands in for any symbol on a line, except the Juliet. Only on reels 2, 3 and 4.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "3, 4 or 5 anywhere give 8, 12 or 20 free spins. Every win in a free spin is doubled.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("India")).toBeInTheDocument();
    expect(screen.getByText("Juliet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "20 win lines, all in play on every spin. A line pays from the left reel.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "The 20 win lines" }),
    ).toBeInTheDocument();
  });

  it("explains cascades, free spins, the meter and the jackpots", () => {
    render(
      <PayTable machine={machine} stake={40} stakes={stakes} jackpotLive />,
    );
    for (const text of [
      "Cascades: winning symbols burst and new ones fall in from above. Each win in a row pays more: x1, x2, x3, x4, then x5.",
      "Free spins: 3, 4 or 5 scatters give 8, 12 or 20. The multiplier starts at x2 and climbs with every win, up to x10. 3 scatters during free spins add 5 more, up to 50.",
      `Meter: every scatter that does not win free spins fills it. At ${machine.meterSize} it pays 8 free spins. One meter for each machine and stake.`,
      "Jackpots: every lost round feeds the Mini, the Major and the Giga. Each must drop before its cap.",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("states the counted figures", () => {
    render(
      <PayTable machine={machine} stake={40} stakes={stakes} jackpotLive />,
    );
    const share = slotJackpotShare(machine);
    const total =
      (slotReturn(machine) + (slotLostRate(machine) * share.num) / share.den) *
      100;
    expect(total).toBeGreaterThan(0);
    expect(
      screen.getByText(
        `This machine pays back ${total.toFixed(1)}% of what goes into it over time, counting the meter and the jackpots. A short session can pay back less, and the meter only pays when it fills.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `One round in ${Math.round(1 / slotPaysRate(machine))} pays something.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Free spins come about once in ${Math.round(1 / slotFreeRate(machine))} rounds; the meter fills about once every ${Math.round(1 / slotMeterRate(machine))}.`,
      ),
    ).toBeInTheDocument();
    // 4000 x 60 / 20 Silver
    expect(
      screen.getByText(
        "The most one paid spin can win at these stakes is 12 Gold. A round with free spins can win more.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `A lost round adds ${((share.num / share.den) * 100).toFixed(1)}% of its stake to the jackpots.`,
      ),
    ).toBeInTheDocument();
  });

  it("reads 105.0 for a real machine", () => {
    render(
      <PayTable
        machine={SLOT_MACHINES[0]}
        stake={40}
        stakes={stakes}
        jackpotLive
      />,
    );
    expect(
      screen.getByText(
        /^This machine pays back 105\.0% of what goes into it over time/,
      ),
    ).toBeInTheDocument();
  });

  it("leaves the jackpot sentence out when the jackpot is not live", () => {
    render(
      <PayTable
        machine={machine}
        stake={40}
        stakes={stakes}
        jackpotLive={false}
      />,
    );
    expect(
      screen.queryByText(/adds .* of its stake to the jackpots/),
    ).not.toBeInTheDocument();
  });
});
