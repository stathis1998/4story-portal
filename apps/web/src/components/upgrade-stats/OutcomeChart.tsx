import type { UpgradeLevelStats } from '@4story-portal/shared'
import { useState } from 'react'
import { attemptsOf, count, FAILURE_PARTS, failuresOf, levelLabel, niceTicks, OUTCOME_COLORS, OUTCOME_LABELS, percent } from '../../lib/upgrade-stats'
import { ChartTooltip } from './chart'
import { barPath, columnLayout, GAP, spacedTicks, useElementWidth } from './chart-layout'

const LEFT = 40
const RIGHT = 12
const TOP = 10
const PLOT = 220
const AXIS = 26
const TICK_GAP = 14

/**
 * One column per level: successes rise above the baseline, failures hang below it, the worst kind
 * nearest the line. Both sides share one count scale, so heights compare honestly.
 */
export function OutcomeChart({ levels, kind }: { levels: UpgradeLevelStats[]; kind: 'scroll' | 'gem' }) {
  const [box, boxWidth] = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const { slot, bar, labelEvery, total } = columnLayout(boxWidth, levels.length, { left: LEFT, right: RIGHT, minSlot: 14, maxSlot: 48, minLabelGap: 26 })

  const upTicks = niceTicks(Math.max(0, ...levels.map((level) => level.success)))
  const downTicks = niceTicks(Math.max(0, ...levels.map(failuresOf)))
  const upMax = upTicks[upTicks.length - 1]
  const downMax = downTicks[downTicks.length - 1]
  const scale = PLOT / (upMax + downMax)
  const baseline = TOP + upMax * scale
  const width = total
  const height = TOP + PLOT + AXIS
  const slotX = (i: number) => LEFT + i * slot
  const ticks = spacedTicks(
    [
      { value: 0, y: baseline },
      ...upTicks.slice(1).map((t) => ({ value: t, y: baseline - t * scale })),
      ...downTicks.slice(1).map((t) => ({ value: t, y: baseline + t * scale })),
    ],
    TICK_GAP,
  )
  const active = hovered === null ? null : levels[hovered]

  return (
    <div ref={box} className={`relative pb-1 ${width > boxWidth ? 'overflow-x-auto' : ''}`}>
      <div className="relative" style={{ width }}>
        <svg width={width} height={height} role="img" aria-label="Upgrade outcomes at each level. The table below has every number." className="block">
          {ticks.map((tick) => (
            <g key={`${tick.value}-${tick.y}`}>
              <line x1={LEFT} x2={width - RIGHT} y1={tick.y} y2={tick.y} stroke="var(--line)" strokeWidth={1} />
              <text x={LEFT - 8} y={tick.y} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {count(tick.value)}
              </text>
            </g>
          ))}

          {levels.map((level, i) => {
            const x = slotX(i) + (slot - bar) / 2
            const lifted = hovered === i
            const parts: { key: string; path: string | null }[] = [
              { key: 'success', path: barPath(x, bar, baseline, baseline - level.success * scale, true) },
            ]
            let cursor = baseline
            const present = FAILURE_PARTS.filter((part) => level[part] > 0)
            present.forEach((part, j) => {
              const end = cursor + level[part] * scale
              const start = j === 0 ? cursor : cursor + GAP
              parts.push({ key: part, path: end - start >= 0.5 ? barPath(x, bar, start, end, j === present.length - 1) : null })
              cursor = end
            })
            return (
              <g key={level.level} opacity={hovered === null || lifted ? 1 : 0.55}>
                {lifted && <rect x={slotX(i)} y={TOP} width={slot} height={PLOT} fill="var(--surface-raised)" />}
                {parts.map(
                  (part) =>
                    part.path && <path key={part.key} d={part.path} fill={OUTCOME_COLORS[part.key as keyof typeof OUTCOME_COLORS]} />,
                )}
                {(hovered === null ? i % labelEvery === 0 : (i - hovered) % labelEvery === 0) && (
                  <text x={slotX(i) + slot / 2} y={TOP + PLOT + 18} textAnchor="middle" className={`text-[11px] tabular-nums ${lifted ? 'fill-fg' : 'fill-muted'}`}>
                    {levelLabel(kind, level.level)}
                  </text>
                )}
                <rect
                  x={slotX(i)}
                  y={0}
                  width={slot}
                  height={height}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${levelLabel(kind, level.level)}: ${count(level.success)} won, ${count(failuresOf(level))} failed`}
                  className="outline-none"
                  onPointerEnter={() => setHovered(i)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                />
              </g>
            )
          })}
          <line x1={LEFT} x2={width - RIGHT} y1={baseline} y2={baseline} stroke="var(--muted)" strokeWidth={1} />
        </svg>
        {active && hovered !== null && (
          <ChartTooltip
            left={Math.min(Math.max(slotX(hovered) + slot / 2, 96), width - 96)}
            title={`${levelLabel(kind, active.level)}: ${count(attemptsOf(active))} ${attemptsOf(active) === 1 ? 'attempt' : 'attempts'}`}
            rows={[
              ...(['success', ...FAILURE_PARTS] as const).map((part) => ({
                label: OUTCOME_LABELS[part],
                value: count(active[part]),
                color: OUTCOME_COLORS[part],
              })),
              ...(attemptsOf(active) > 0
                ? [{ label: `won, odds said ${Math.round(active.expectedRate * 100)}%`, value: percent(active.success, attemptsOf(active)) }]
                : []),
            ]}
          />
        )}
      </div>
    </div>
  )
}
