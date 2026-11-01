import {
  EVENT_TYPE_NAMES,
  type GmEvent,
  gmEventInputSchema,
  type GmEventInput,
  type GmMap,
  isDropEvent,
  PERCENT_EVENT_TYPES,
} from '@4story-portal/shared'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { formatWallClock, mapOptionLabel } from '../../lib/gm'
import { Button } from '../Button'
import { FormMessage } from '../FormMessage'
import { Select } from '../Select'
import { TextField } from '../TextField'

type Props = {
  /** The event being edited; a new event when absent. */
  event?: GmEvent
  worlds: { id: number; name: string }[]
  maps: GmMap[]
  /** The server's clock, as `YYYY-MM-DDTHH:mm`. */
  serverNow: string
  /** Resolves to an error message to show in the form, or null once saved. */
  onSubmit: (input: GmEventInput) => Promise<string | null>
  onCancel: () => void
}

type FormValues = {
  type: number
  world: number
  title: string
  bonus: number
  /** Empty is all maps. */
  mapId: string
  mode: 'period' | 'daily'
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  startMessage: string
  endMessage: string
  startNoticeMinutes: number
  endNoticeMinutes: number
}

const FIELD_FOR_PATH: Record<string, keyof FormValues> = {
  'schedule.start': 'startDate',
  'schedule.end': 'endDate',
  'schedule.mode': 'mode',
}

const BONUS_MEANING: Record<number, string> = {
  1: '+100% = double EXP from kills',
  3: '+100% = double the chance of each drop, up to 100%',
  4: '+100% = double the chance a dropped item is magic',
  11: '+100% = double the money monsters drop',
}
const CHANCE_MEANING = '+100% = double the chance of success, up to 100%'

const minutes = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`

const eventLabel = (type: number, bonus: number) =>
  Number.isFinite(bonus) ? `${EVENT_TYPE_NAMES[type]} +${bonus}% event` : `${EVENT_TYPE_NAMES[type]} event`

const startMessageFor = (type: number, bonus: number, notice: number) =>
  notice > 0
    ? `${eventLabel(type, bonus)} starts in ${minutes(notice)}.`
    : `${eventLabel(type, bonus)} has started!`

const endMessageFor = (type: number, bonus: number, notice: number) =>
  notice > 0 ? `${eventLabel(type, bonus)} ends in ${minutes(notice)}.` : `${eventLabel(type, bonus)} is ending.`

function defaultValues(event: GmEvent | undefined, worlds: Props['worlds']): FormValues {
  if (event) {
    const { mode, start, end } = event.schedule
    return {
      type: event.type,
      world: event.world,
      title: event.title,
      bonus: event.bonus ?? 0,
      mapId: event.mapId === null ? '' : String(event.mapId),
      mode,
      startDate: start.slice(0, 10),
      startTime: start.slice(11),
      endDate: end.slice(0, 10),
      endTime: end.slice(11),
      startMessage: event.startMessage,
      endMessage: event.endMessage,
      startNoticeMinutes: event.startNoticeMinutes,
      endNoticeMinutes: event.endNoticeMinutes,
    }
  }
  const [firstType] = PERCENT_EVENT_TYPES
  return {
    type: firstType,
    world: worlds[0]?.id ?? 0,
    title: '',
    bonus: Number.NaN,
    mapId: '',
    mode: 'period',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    startMessage: startMessageFor(firstType, Number.NaN, 0),
    endMessage: endMessageFor(firstType, Number.NaN, 1),
    startNoticeMinutes: 0,
    endNoticeMinutes: 1,
  }
}

function toInput(values: FormValues, event: GmEvent | undefined) {
  // The type and world of an existing event can't change: see section 2.6 of the design.
  const type = event?.type ?? values.type
  return {
    type,
    world: event?.world ?? values.world,
    title: values.title,
    bonus: values.bonus,
    mapId: isDropEvent(type) && values.mapId !== '' ? Number(values.mapId) : null,
    schedule: {
      mode: values.mode,
      start: `${values.startDate}T${values.startTime}`,
      end: `${values.endDate}T${values.endTime}`,
    },
    startMessage: values.startMessage,
    endMessage: values.endMessage,
    startNoticeMinutes: values.startNoticeMinutes,
    endNoticeMinutes: values.endNoticeMinutes,
  }
}

export function EventForm({ event, worlds, maps, serverNow, onSubmit, onCancel }: Props) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: defaultValues(event, worlds) })
  const [message, setMessage] = useState<string | null>(null)
  // Not dirtyFields: it compares with the defaults, so it counts the messages generated below as edits.
  const [startMessageEdited, setStartMessageEdited] = useState(false)
  const [endMessageEdited, setEndMessageEdited] = useState(false)

  const watchedType = useWatch({ control, name: 'type' })
  const type = event?.type ?? watchedType
  const bonus = useWatch({ control, name: 'bonus' })
  const mode = useWatch({ control, name: 'mode' })
  const startNotice = useWatch({ control, name: 'startNoticeMinutes' })
  const endNotice = useWatch({ control, name: 'endNoticeMinutes' })

  // Messages follow the other fields on a new event, until the GM writes their own.
  useEffect(() => {
    if (event) return
    if (!startMessageEdited) setValue('startMessage', startMessageFor(type, bonus, startNotice))
    if (!endMessageEdited) setValue('endMessage', endMessageFor(type, bonus, endNotice))
  }, [event, type, bonus, startNotice, endNotice, startMessageEdited, endMessageEdited, setValue])

  async function submit(values: FormValues) {
    setMessage(null)
    const parsed = gmEventInputSchema.safeParse(toInput(values, event))
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.')
        const field = FIELD_FOR_PATH[path] ?? (path as keyof FormValues)
        setError(field, { message: issue.message })
      }
      return
    }
    setMessage(await onSubmit(parsed.data))
  }

  // A map can stop being hosted while an event still names it, so it stays pickable.
  const currentMap = event?.mapId ?? null
  const mapOptions = [
    { value: '', label: 'All maps' },
    ...maps.map((map) => ({ value: map.id, label: mapOptionLabel(map) })),
    ...(currentMap !== null && !maps.some((map) => map.id === currentMap)
      ? [{ value: currentMap, label: `Map ${currentMap} (not hosted)` }]
      : []),
  ]

  const period = mode === 'period'

  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate
      aria-label={event ? `Edit ${event.title}` : 'New event'}
      className="flex flex-col gap-4 rounded-xs border border-line bg-surface p-4"
    >
      <h2 className="text-xl">{event ? `Edit ${event.title}` : 'New event'}</h2>

      {event?.running && (
        <p className="rounded-xs border border-line bg-surface-raised px-3 py-2 text-sm">
          Saving restarts this event, so players see the start message again and the bonus drops out for a second or
          two.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {event ? (
          <p className="text-sm text-muted">
            {event.typeName}. To change the type, stop this event and create a new one.
          </p>
        ) : (
          <Select
            label="Type"
            registration={register('type', { valueAsNumber: true })}
            options={PERCENT_EVENT_TYPES.map((value) => ({ value, label: EVENT_TYPE_NAMES[value] }))}
          />
        )}
        {!event && worlds.length > 1 && (
          <Select
            label="World"
            registration={register('world', { valueAsNumber: true })}
            options={worlds.map((world) => ({ value: world.id, label: world.name }))}
          />
        )}
        <TextField label="Title" registration={register('title')} error={errors.title?.message} />
        <div className="flex flex-col gap-1.5">
          <TextField
            label="Bonus (%)"
            type="number"
            registration={register('bonus', { valueAsNumber: true })}
            error={errors.bonus?.message}
          />
          <p className="text-xs text-muted">{BONUS_MEANING[type] ?? CHANCE_MEANING}</p>
        </div>
        {isDropEvent(type) && <Select label="Map" registration={register('mapId')} options={mapOptions} />}
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm text-muted">Server time, now {formatWallClock(serverNow)}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Schedule"
            registration={register('mode')}
            options={[
              { value: 'period', label: 'One period' },
              { value: 'daily', label: 'Daily' },
            ]}
          />
          {period && (
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setValue('startDate', serverNow.slice(0, 10))
                  setValue('startTime', serverNow.slice(11))
                }}
              >
                Start now
              </Button>
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={period ? 'Start date' : 'First day'}
            type="date"
            registration={register('startDate')}
            error={errors.startDate?.message}
          />
          <TextField label={period ? 'Start time' : 'From'} type="time" registration={register('startTime')} />
          <TextField
            label={period ? 'End date' : 'Last day'}
            type="date"
            registration={register('endDate')}
            error={errors.endDate?.message}
          />
          <TextField label={period ? 'End time' : 'To'} type="time" registration={register('endTime')} />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <TextField
          label="Start message"
          registration={register('startMessage', { onChange: () => setStartMessageEdited(true) })}
          error={errors.startMessage?.message}
        />
        <TextField
          label="Minutes before start"
          type="number"
          registration={register('startNoticeMinutes', { valueAsNumber: true })}
          error={errors.startNoticeMinutes?.message}
        />
        <TextField
          label="End message"
          registration={register('endMessage', { onChange: () => setEndMessageEdited(true) })}
          error={errors.endMessage?.message}
        />
        <TextField
          label="Minutes before end"
          type="number"
          registration={register('endNoticeMinutes', { valueAsNumber: true })}
          error={errors.endNoticeMinutes?.message}
        />
      </div>

      <FormMessage message={message} />
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save event'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
