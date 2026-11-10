import type { UpgradeDay } from '@4story-portal/shared'
import { useState } from 'react'
import { formatDay } from '../../lib/stats'
import { count, niceTicks } from '../../lib/upgrade-stats'
import { ChartTooltip } from './chart'
import { barPath, columnLayout, useElementWidth } from './chart-layout'

const LEFT = 40
const RIGHT = 4
const TOP = 10
const PLOT = 120
const AXIS = 24
// A date under every seventh day, counted back from today so the last one is always labelled.
const LABEL_EVERY = 7

/** Successes above the line and failures below, one column per day. */
export function DailyChart({ days }: { days: UpgradeDay[] }) {
  const [box, boxWidth] = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const { slot, bar, total: width } = columnLayout(boxWidth, days.length, { left: LEFT, right: RIGHT, minSlot: 9, maxSlot: 28, minLabelGap: 0 })
  const upTicks = niceTicks(Math.max(0, ...days.map((day) => day.success)))
  const downTicks = niceTicks(Math.max(0, ...days.map((day) => day.failed)))
  const upMax = upTicks[upTicks.length - 1]
  const downMax = downTicks[downTicks.length - 1]
  const scale = PLOT / (upMax + downMax)
  const baseline = TOP + upMax * scale
  const height = TOP + PLOT + AXIS
  const slotX = (i: number) => LEFT + i * slot
  const active = hovered === null ? null : days[hovered]

  return (
    <div ref={box} className={`relative pb-1 ${width > boxWidth ? 'overflow-x-auto' : ''}`}>
      <div className="relative" style={{ width }}>
        <svg width={width} height={height} role="img" aria-label="Successes and failures per day for the last 30 days" className="block">
          {[upMax, -downMax].map((tick) => (
            <g key={tick}>
              <line x1={LEFT} x2={width - RIGHT} y1={baseline - tick * scale} y2={baseline - tick * scale} stroke="var(--line)" strokeWidth={1} />
              <text x={LEFT - 8} y={baseline - tick * scale} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {count(Math.abs(tick))}
              </text>
            </g>
          ))}
          {days.map((day, i) => {
            const x = slotX(i) + (slot - bar) / 2
            const up = barPath(x, bar, baseline, baseline - day.success * scale, true)
            const down = barPath(x, bar, baseline, baseline + day.failed * scale, true)
            const labelled = (days.length - 1 - i) % LABEL_EVERY === 0
            return (
              <g key={day.date} opacity={hovered === null || hovered === i ? 1 : 0.55}>
                {hovered === i && <rect x={slotX(i)} y={TOP} width={slot} height={PLOT} fill="var(--surface-raised)" />}
                {up && <path d={up} fill="var(--viz-success)" />}
                {down && <path d={down} fill="var(--viz-destroyed)" />}
                {labelled && (
                  <text
                    x={i === days.length - 1 ? slotX(i) + slot : slotX(i) + slot / 2}
                    y={TOP + PLOT + 17}
                    textAnchor={i === days.length - 1 ? 'end' : 'middle'}
                    className="fill-muted text-[11px]"
                  >
                    {formatDay(day.date)}
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
                  aria-label={`${formatDay(day.date)}: ${count(day.success)} won, ${count(day.failed)} failed`}
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
            title={formatDay(active.date)}
            rows={[
              { label: 'won', value: count(active.success), color: 'var(--viz-success)' },
              { label: 'failed', value: count(active.failed), color: 'var(--viz-destroyed)' },
            ]}
          />
        )}
      </div>
    </div>
  )
}
