import { silverText } from '@4story-portal/shared'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { showing } from '../../test/slot-fixture'
import { PayTable } from './PayTable'

const C = 32 ** 5
const base = showing(['GHGHG', 'HGHGH', 'GHGHG'])
const machine = {
  ...base,
  counts: { linePaid: 20 * 0.5 * C, blank: 0.75 * C, scatters: [C / 100, 0, 0] as [number, number, number], blankScatters: [C / 200, 0, 0] as [number, number, number], best: 4000 },
}
const stakes: [number, number, number] = [20, 40, 60]

describe('the pay table', () => {
  it('lists the paying symbols top prize first, with prizes as money at the stake', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} jackpotLive />)
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
    const hotel = within(rows[0]).getAllByRole('cell').map((td) => td.textContent)
    expect(hotel).toEqual([silverText(40 * 2), silverText(160 * 2), silverText(800 * 2)])
    expect(hotel[2]).toBe('1 Gold 600 Silver')
  })

  it('names the wild and the scatter and what they do', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} jackpotLive />)
    expect(screen.getByText('Stands in for any symbol on a line, except the Juliet. Only on reels 2, 3 and 4.')).toBeInTheDocument()
    expect(screen.getByText('3, 4 or 5 anywhere give 8, 12 or 20 free spins. Every win in a free spin is doubled.')).toBeInTheDocument()
    expect(screen.getByText('India')).toBeInTheDocument()
    expect(screen.getByText('Juliet')).toBeInTheDocument()
    expect(screen.getByText('20 win lines, all in play on every spin. A line pays from the left reel.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'The 20 win lines' })).toBeInTheDocument()
  })

  it('states the counted figures', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} jackpotLive />)
    // return = 0.5 x (1 + 2 x 8 x 0.01) = 0.58
    // lost = 0.745 + 0.005 x 0.75^8 = 0.7455; 1 / (1 - 0.7455) = 3.93
    expect(
      screen.getByText('This machine pays back 58.0% of what goes into it, over time, free spins counted. One round in 4 pays something.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Free spins come about once in 100 rounds.')).toBeInTheDocument()
    // 4000 x 60 / 20 Silver
    expect(screen.getByText('The most one paid spin can win at these stakes is 12 Gold.')).toBeInTheDocument()
    // (1 - 0.58) / 0.7455 = 0.563
    expect(
      screen.getByText('A lost round on this machine adds 56.3% of its stake to the jackpot. With the jackpot, the slots pay back everything staked, over time.'),
    ).toBeInTheDocument()
  })

  it('leaves the jackpot sentence out when the jackpot is not live', () => {
    render(<PayTable machine={machine} stake={40} stakes={stakes} jackpotLive={false} />)
    expect(screen.queryByText(/adds .* of its stake to the jackpot/)).not.toBeInTheDocument()
  })
})
