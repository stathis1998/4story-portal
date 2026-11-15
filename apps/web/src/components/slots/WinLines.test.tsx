import { SLOT_LINES } from '@4story-portal/shared'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LineMap, linePoints, WinLines } from './WinLines'

describe('the win lines', () => {
  it('draws a line through the middle of its tiles', () => {
    expect(linePoints(3)).toBe('0.5,0.5 1.5,1.5 2.5,2.5 3.5,1.5 4.5,0.5')
    expect(linePoints(0)).toBe('0.5,1.5 1.5,1.5 2.5,1.5 3.5,1.5 4.5,1.5')
  })

  it('draws one polyline per line given, and twenty numbered grids in the map', () => {
    const { container } = render(<WinLines lines={[0, 3, 19]} colour="#7ef0d2" />)
    const svg = container.querySelector('svg')!
    // Stretched over the whole window, one unit a tile, so a point lands on its tile's middle.
    expect(svg).toHaveAttribute('viewBox', '0 0 5 3')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    const lines = [...svg.querySelectorAll('polyline')]
    expect(lines.map((line) => line.getAttribute('points'))).toEqual([linePoints(0), linePoints(3), linePoints(19)])
    for (const line of lines) {
      expect(line).toHaveAttribute('stroke', '#7ef0d2')
      expect(line).toHaveAttribute('vector-effect', 'non-scaling-stroke')
    }
    render(<WinLines lines={[]} colour="#7ef0d2" />)
    expect(document.querySelectorAll('polyline')).toHaveLength(3)

    render(<LineMap />)
    const map = screen.getByRole('list', { name: 'The 20 win lines' })
    const items = within(map).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(SLOT_LINES.map((_, i) => `Line ${i + 1}`))
    // Each grid lights one tile a reel: the line's row on that reel.
    items.forEach((item, line) => {
      const lit = [...item.querySelectorAll('rect[data-lit]')].map((rect) => [Number(rect.getAttribute('x')), Number(rect.getAttribute('y'))])
      expect(lit.map(([x, y]) => [Math.floor(x), Math.floor(y)])).toEqual(SLOT_LINES[line].map((row, reel) => [reel, row]))
      expect(item.querySelectorAll('rect')).toHaveLength(15)
    })
  })
})
