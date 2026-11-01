import type { ActivityDay } from '@4story-portal/shared'
import { calendarDays, formatMinutes } from '../../lib/stats'

function shade(minutes: number) {
  if (minutes === 0) return 'bg-line'
  if (minutes < 60) return 'bg-accent/35'
  if (minutes < 180) return 'bg-accent/65'
  return 'bg-accent'
}

export function ActivityCalendar({ today, activity }: { today: string; activity: ActivityDay[] }) {
  const minutes = new Map(activity.map((day) => [day.date, day.minutes]))

  return (
    <div className="overflow-x-auto pb-1">
      <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]">
        {calendarDays(today).map((date) => {
          const played = minutes.get(date) ?? 0
          const label = `${date}: ${played ? formatMinutes(played) : 'not played'}`
          return <span key={date} role="img" aria-label={label} title={label} className={`size-[11px] rounded-[2px] ${shade(played)}`} />
        })}
      </div>
    </div>
  )
}
