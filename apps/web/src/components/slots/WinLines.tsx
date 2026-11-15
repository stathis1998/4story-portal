import { SLOT_LINES, SLOT_REELS, SLOT_ROWS } from '@4story-portal/shared'
import type { ReactNode } from 'react'

const BOX = `0 0 ${SLOT_REELS} ${SLOT_ROWS}`

/** 'x,y x,y ...' through the middles of a line's five tiles in a 5 x 3 box. */
// Beside the lines it draws, so what is tested is what is drawn; a hot reload of this file reloads the page.
// eslint-disable-next-line react-refresh/only-export-components
export function linePoints(line: number): string {
  return SLOT_LINES[line].map((row, reel) => `${reel + 0.5},${row + 0.5}`).join(' ')
}

/**
 * The given lines (indexes into SLOT_LINES) drawn across the window it is laid over. The box is stretched to the
 * window, one unit a tile, so the points land on the tiles' middles; the stroke keeps its width however it stretches.
 */
export function WinLines({ lines, colour }: { lines: readonly number[]; colour: string }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox={BOX}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      // A dark edge, so a line reads over any icon.
      style={{ filter: 'drop-shadow(0 0 2px rgb(0 0 0 / 0.9))' }}
    >
      {lines.map((line) => (
        <polyline
          key={line}
          points={linePoints(line)}
          fill="none"
          stroke={colour}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

/** All 20 lines as small 5 x 3 grids, numbered, for the pay table. */
export function LineMap(): ReactNode {
  return (
    <ol aria-label="The 20 win lines" className="grid grid-cols-5 gap-x-2 gap-y-3 sm:grid-cols-10">
      {SLOT_LINES.map((rows, line) => (
        <li key={line} className="flex flex-col items-center gap-1 text-xs text-muted tabular-nums">
          <svg aria-hidden="true" viewBox={BOX} className="h-6 w-10">
            {rows.map((onRow, reel) =>
              Array.from({ length: SLOT_ROWS }, (_, row) => (
                <rect
                  key={`${reel}-${row}`}
                  data-lit={row === onRow ? 'true' : undefined}
                  x={reel + 0.08}
                  y={row + 0.08}
                  width={0.84}
                  height={0.84}
                  rx={0.15}
                  className={row === onRow ? 'fill-accent' : 'fill-line'}
                />
              )),
            )}
          </svg>
          <span>
            <span className="sr-only">Line </span>
            {line + 1}
          </span>
        </li>
      ))}
    </ol>
  )
}
