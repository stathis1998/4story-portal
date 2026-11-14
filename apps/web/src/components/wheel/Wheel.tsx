import { segmentAngle, segmentLabel, segmentPath, SPIN_SECONDS } from '../../lib/wheel'

type Props = {
  prizes: { id: number; name: string; announce: boolean }[]
  /** How far the wheel is turned, in degrees. It only ever grows, so the wheel always turns forward. */
  rotation: number
  /** Turn to `rotation` over a few seconds instead of jumping there. */
  animate: boolean
  onStopped: () => void
}

const SIZE = 400
const CENTER = SIZE / 2
const RADIUS = 188

// Crimson and dark stone take turns. An odd number of segments would put two of one colour side by
// side where the wheel closes, so the last one gets a third.
const FILLS = [
  { fill: 'var(--accent)', text: 'var(--accent-fg)' },
  { fill: 'var(--surface-raised)', text: 'var(--fg)' },
  { fill: '#4a3a34', text: 'var(--fg)' },
]
const fillOf = (index: number, count: number) => FILLS[count % 2 === 1 && count > 1 && index === count - 1 ? 2 : index % 2]

/** The wheel of prizes: equal segments clockwise from the top, under a fixed pointer. */
export function Wheel({ prizes, rotation, animate, onStopped }: Props) {
  const count = prizes.length
  const fontSize = count <= 8 ? 15 : count <= 12 ? 13 : 11

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Wheel with ${count} ${count === 1 ? 'prize' : 'prizes'}`}
      className="mx-auto block w-full max-w-[26rem] select-none"
    >
      <circle cx={CENTER} cy={CENTER} r={RADIUS + 8} fill="var(--line)" />
      <g
        data-testid="wheel-disc"
        // Only the disc itself has a transition, and only on its turn.
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) onStopped()
        }}
        style={{
          transform: `rotate(${rotation}deg)`,
          transformOrigin: `${CENTER}px ${CENTER}px`,
          transition: animate ? `transform ${SPIN_SECONDS}s cubic-bezier(0.12, 0.75, 0.2, 1)` : 'none',
        }}
      >
        {prizes.map((prize, index) => {
          const colour = fillOf(index, count)
          return (
            <g key={prize.id}>
              <path d={segmentPath(index, count, RADIUS, CENTER)} fill={colour.fill} stroke="var(--bg)" strokeWidth={2} />
              {/* Written along the segment, from the hub outward. */}
              <text
                x={CENTER + RADIUS - 12}
                y={CENTER}
                textAnchor="end"
                dominantBaseline="central"
                transform={`rotate(${segmentAngle(index, count) - 90} ${CENTER} ${CENTER})`}
                fill={colour.text}
                fontSize={fontSize}
                fontWeight={700}
              >
                {prize.announce ? '★ ' : ''}
                {segmentLabel(prize.name)}
              </text>
            </g>
          )
        })}
      </g>
      <circle cx={CENTER} cy={CENTER} r={26} fill="var(--bg)" stroke="var(--line)" strokeWidth={3} />
      <path d={`M ${CENTER - 16} 2 L ${CENTER + 16} 2 L ${CENTER} 34 Z`} fill="var(--fg)" stroke="var(--bg)" strokeWidth={2} />
    </svg>
  )
}
