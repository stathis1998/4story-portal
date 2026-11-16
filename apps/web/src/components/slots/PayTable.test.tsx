import { SLOT_MACHINES, silverText } from '@4story-portal/shared'
import type { SlotMachine, SlotPot } from '@4story-portal/shared'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { showing } from '../../test/slot-fixture'
import { PayTable } from './PayTable'

const base = showing(['GHGHG', 'HGHGH', 'GHGHG'])
// Hand-set counts, worked out below by hand from the design's formulas (not by the figure functions), meter size 30.
// 1,000 windows. 200 win one step of 42 line stakes and show no scatter; the other 800 win nothing. No window
// retriggers. By scatters in the last window: 850 none (650 of them blank), 50 one, 40 two, 60 three.
const steps = new Array(26 * 12).fill(0)
// W = 1 winning step, no retrigger: bucket (1 x 2 + 0) x 12 + step 0. 200 windows x 42 line stakes.
steps[2 * 12] = 8400
const free = new Array(26).fill(0)
free[0] = 800
free[2] = 200
const machine: SlotMachine = {
  ...base,
  counts: {
    last: [850, 50, 40, 60, 0, 0],
    blankLast: [650, 50, 40, 60, 0, 0],
    free,
    steps,
    best: 4000,
    longest: 1,
    capped: 0,
  },
}
// The working:
//   A spin wins 42 line stakes with chance 0.2, at times 1 in a paid spin: 8.4 line stakes.
//   8 free spins from times 2, each win raising it (never past 9 in 8 spins, so never at the cap of 10):
//     spin k (0-7) expects 0.2 x 42 x (2 + 0.2k); together 8.4 x (16 + 0.2 x 28) = 181.44 line stakes.
//   The meter fills (50 x 1 + 40 x 2) / (1,000 x 30) = 130 / 30,000 of rounds, once every 230.8; free spins come
//     60 / 1,000, once in 16.7.
//   R = (8.4 + 0.06 x 181.44 + 130 / 30,000 x 181.44) / 20 = (8.4 + 10.8864 + 0.78624) / 20 = 1.003632.
//   8 free spins pay nothing with chance 0.8^8 = 0.16777216 (Q8). A round is lost with chance
//   L = 0.65 + 0.05 x (1 - 1/30 + Q8/30) + 0.04 x (1 - 2/30 + 2 Q8/30) + 0.06 x Q8
//     = 0.65 + 0.0486129536 + 0.0377807258 + 0.0100663296 = 0.746460009,
//   so one round in 1 / (1 - L) = 3.94 pays something.
//   The pots' share of a lost stake: (1.05 - R) / L = 0.046368 / 0.746460009 = 6.2117% (less a billionth):
//     the Mini 30% of it, 1.8635%; the Major 1.8635%; the Giga 40%, 2.4847%.
//   With all three on: R + L x 6.2117% = 105.0%. The Mini and the Giga only: 70% of it, 4.3482%, and
//   R + 0.7 x 0.046368 = 103.6%. The Giga only: R + 0.4 x 0.046368 = 102.2%. None: R = 100.4%.
const stakes: [number, number, number] = [20, 40, 60]
const ALL: SlotPot[] = ['mini', 'major', 'giga']

describe('the pay table', () => {
  it('lists the paying symbols top prize first, with prizes as money at the stake', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} livePots={ALL} />)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(8)
    expect(rows.map((row) => within(row).getAllByRole('rowheader')[0].textContent)).toEqual([
      'Hotel',
      'Golf',
      'Foxtrot',
      'Echo',
      'Delta',
      'Charlie',
      'Bravo',
      'Alpha' + 'Two from the left: 4 Silver',
    ])
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Symbol', '3', '4', '5'])
    // Symbol 7: [40, 160, 800] line stakes at a line stake of 2 Silver.
    const hotel = within(rows[0])
      .getAllByRole('cell')
      .map((td) => td.textContent)
    expect(hotel).toEqual([silverText(40 * 2), silverText(160 * 2), silverText(800 * 2)])
    expect(hotel[2]).toBe('1 Gold 600 Silver')
  })

  it('names the wild and the scatter and what they do', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} livePots={ALL} />)
    expect(screen.getByText('Stands in for any symbol on a line, except the Juliet. Only on reels 2, 3 and 4.')).toBeInTheDocument()
    expect(screen.getByText('3, 4 or 5 anywhere give 8, 12 or 20 free spins.')).toBeInTheDocument()
    expect(screen.getByText('India')).toBeInTheDocument()
    expect(screen.getByText('Juliet')).toBeInTheDocument()
    expect(screen.getByText('20 win lines, all in play on every spin. A line pays from the left reel.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'The 20 win lines' })).toBeInTheDocument()
  })

  it('explains cascades, free spins, the meter and the jackpots', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} livePots={ALL} />)
    for (const text of [
      'Cascades: winning symbols burst and new ones fall in from above. Each win in a row pays more: x1, x2, x3, x4, then x5.',
      'Free spins: 3, 4 or 5 scatters give 8, 12 or 20. The multiplier starts at x2 and climbs with every win, up to x10. 3 scatters during free spins add 5 more, up to 50.',
      `Meter: every scatter that does not win free spins fills it. At ${machine.meterSize} it pays 8 free spins. One meter for each machine and stake.`,
      'Jackpots: every lost round feeds the Mini, the Major and the Giga. Each must drop before its cap.',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it('states the counted figures', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} livePots={ALL} />)
    expect(
      screen.getByText(
        'This machine pays back 105.0% of what goes into it over time, counting the meter and the jackpots. A short session can pay back less, and the meter only pays when it fills.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('One round in 3.9 pays something.')).toBeInTheDocument()
    expect(screen.getByText('Free spins come about once in 17 rounds; the meter fills about once every 231.')).toBeInTheDocument()
    // 4000 x 60 / 20 Silver
    expect(
      screen.getByText('The most one paid spin can win at these stakes is 12 Gold. A round with free spins can win more.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('A lost round adds 6.2% of its stake to the jackpots: 1.9% to the Mini, 1.9% to the Major and 2.5% to the Giga.'),
    ).toBeInTheDocument()
  })

  it('counts only the pots that are on', () => {
    const { rerender } = render(<PayTable machine={machine} stake={40} stakes={stakes} livePots={['giga', 'mini']} />)
    expect(
      screen.getByText(
        'This machine pays back 103.6% of what goes into it over time, counting the meter and the jackpots that are on. A short session can pay back less, and the meter only pays when it fills.',
      ),
    ).toBeInTheDocument()
    // Mini first, whatever order the pots come in.
    expect(screen.getByText('A lost round adds 4.3% of its stake to the jackpots: 1.9% to the Mini and 2.5% to the Giga.')).toBeInTheDocument()

    rerender(<PayTable machine={machine} stake={40} stakes={stakes} livePots={['giga']} />)
    expect(screen.getByText(/^This machine pays back 102\.2% of what goes into it over time, counting the meter and the jackpots that are on\./)).toBeInTheDocument()
    expect(screen.getByText('A lost round adds 2.5% of its stake to the jackpots: 2.5% to the Giga.')).toBeInTheDocument()
  })

  it('with no pot on, counts the meter alone and leaves the jackpot sentence out', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} livePots={[]} />)
    expect(
      screen.getByText(
        'This machine pays back 100.4% of what goes into it over time, counting the meter. A short session can pay back less, and the meter only pays when it fills.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/of its stake to the jackpots/)).not.toBeInTheDocument()
  })

  it('reads 105.0 for a real machine with all three pots on, and how often each machine pays to one decimal', () => {
    // The design's targets, met by the counted strips: one round in 1.8, 2.0 and 2.4 pays something.
    const pays = ['One round in 1.8 pays something.', 'One round in 2.0 pays something.', 'One round in 2.4 pays something.']
    SLOT_MACHINES.forEach((real, i) => {
      const { unmount } = render(<PayTable machine={real} stake={40} stakes={stakes} livePots={ALL} />)
      expect(screen.getByText(/^This machine pays back 105\.0% of what goes into it over time, counting the meter and the jackpots\./)).toBeInTheDocument()
      expect(screen.getByText(pays[i])).toBeInTheDocument()
      unmount()
    })
  })
})
