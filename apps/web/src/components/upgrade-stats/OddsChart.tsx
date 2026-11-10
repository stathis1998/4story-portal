import type { UpgradeLevelStats } from '@4story-portal/shared'
import { useState } from 'react'
import { attemptsOf, count, levelLabel, percent } from '../../lib/upgrade-stats'
import { ChartTooltip } from './chart'
import { columnLayout, useElementWidth } from './chart-layout'

const LEFT = 40
const RIGHT = 12
const TOP = 10
const PLOT = 160
const AXIS = 26
const TICKS = [0, 25, 50, 75, 100]

/**
 * Per level, the success rate the odds promised (a tick) against what really happened (a dot).
 * The line between them is blue when players beat the odds and red when the odds beat them.
 */
export function OddsChart({ levels, kind }: { levels: UpgradeLevelStats[]; kind: 'scroll' | 'gem' }) {
  const [box, boxWidth] = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const { slot, labelEvery, total: width } = columnLayout(boxWidth, levels.length, { left: LEFT, right: RIGHT, minSlot: 14, maxSlot: 48, minLabelGap: 26 })
  const height = TOP + PLOT + AXIS
  const y = (rate: number) => TOP + PLOT - rate * PLOT
  const centre = (i: number) => LEFT + i * slot + slot / 2
  const tick = Math.min(7, slot / 2 - 1)
  const active = hovered === null ? null : levels[hovered]

  return (
    <div ref={box} className={`relative pb-1 ${width > boxWidth ? 'overflow-x-auto' : ''}`}>
      <div className="relative" style={{ width }}>
        <svg width={width} height={height} role="img" aria-label="Success rate at each level against the odds. The table below has every number." className="block">
          {TICKS.map((value) => (
            <g key={value}>
              <line x1={LEFT} x2={width - RIGHT} y1={y(value / 100)} y2={y(value / 100)} stroke="var(--line)" strokeWidth={1} />
              <text x={LEFT - 8} y={y(value / 100)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {value}%
              </text>
            </g>
          ))}
          {levels.map((level, i) => {
            const attempts = attemptsOf(level)
            const cx = centre(i)
            const lifted = hovered === i
            const label = (hovered === null ? i % labelEvery === 0 : (i - hovered) % labelEvery === 0) && (
              <text x={cx} y={TOP + PLOT + 18} textAnchor="middle" className={`text-[11px] tabular-nums ${lifted ? 'fill-fg' : 'fill-muted'}`}>
                {levelLabel(kind, level.level)}
              </text>
            )
            if (attempts === 0) return <g key={level.level}>{label}</g>
            const actual = level.success / attempts
            const lucky = actual >= level.expectedRate
            return (
              <g key={level.level} opacity={hovered === null || lifted ? 1 : 0.55}>
                {lifted && <rect x={cx - slot / 2} y={TOP} width={slot} height={PLOT} fill="var(--surface-raised)" />}
                <line
                  x1={cx}
                  x2={cx}
                  y1={y(level.expectedRate)}
                  y2={y(actual)}
                  stroke={lucky ? 'var(--viz-success)' : 'var(--viz-destroyed)'}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <line x1={cx - tick} x2={cx + tick} y1={y(level.expectedRate)} y2={y(level.expectedRate)} stroke="var(--secondary)" strokeWidth={2} strokeLinecap="round" />
                <circle cx={cx} cy={y(actual)} r={4} fill="var(--fg)" stroke="var(--surface)" strokeWidth={2} />
                {label}
                <rect
                  x={cx - slot / 2}
                  y={0}
                  width={slot}
                  height={height}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${levelLabel(kind, level.level)}: won ${percent(level.success, attempts)}, odds ${Math.round(level.expectedRate * 100)}%`}
                  className="outline-none"
                  onPointerEnter={() => setHovered(i)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                />
              </g>
            )
          })}
        </svg>
        {active && hovered !== null && attemptsOf(active) > 0 && (
          <ChartTooltip
            left={Math.min(Math.max(centre(hovered), 96), width - 96)}
            title={`${levelLabel(kind, active.level)}: ${count(attemptsOf(active))} ${attemptsOf(active) === 1 ? 'attempt' : 'attempts'}`}
            rows={[
              { label: 'won', value: percent(active.success, attemptsOf(active)), color: 'var(--fg)' },
              { label: 'the odds', value: `${Math.round(active.expectedRate * 100)}%`, color: 'var(--secondary)' },
            ]}
          />
        )}
      </div>
    </div>
  )
}
