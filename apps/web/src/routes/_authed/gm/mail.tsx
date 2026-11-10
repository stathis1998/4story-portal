import {
  type GmItemSearchResult,
  type GmMailAudience,
  type GmMailRequest,
  type GmMailResult,
  gmMailRequestSchema,
  MAIL_MAX_ITEMS,
} from '@4story-portal/shared'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { FormMessage } from '../../../components/FormMessage'
import { GameIcon } from '../../../components/gm/GameIcon'
import { GmNav } from '../../../components/gm/GmNav'
import { MailItemPicker } from '../../../components/gm/MailItemPicker'
import { MailRecipients } from '../../../components/gm/MailRecipients'
import { ApiError } from '../../../lib/api'
import { gmCharactersQueryOptions, itemDisplayName, useSendMail } from '../../../lib/gm'
import { audienceNames, withNames } from '../../../lib/mail-recipients'
import { meQueryOptions } from '../../../lib/session'

export const Route = createFileRoute('/_authed/gm/mail')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me?.isGm) throw redirect({ to: '/characters' })
  },
  component: MailPage,
})

type ItemRow = { item: GmItemSearchResult; count: number }

const COINS = [
  ['gold', 'Rune'],
  ['silver', 'Luna'],
  ['copper', 'Cron'],
] as const

const field =
  'rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent'
const labelText = 'text-xs font-bold tracking-wider text-muted uppercase'

const errorMessage = (err: unknown) =>
  err instanceof ApiError && err.status < 500 ? err.message : 'Something went wrong. Please try again.'

const UNKNOWN_PREFIX = 'Unknown characters: '

/** The names in the API's "Unknown characters: A, B" refusal, lowercased. */
const unknownNames = (err: unknown): Set<string> =>
  err instanceof ApiError && err.status === 422 && err.message.startsWith(UNKNOWN_PREFIX)
    ? new Set(err.message.slice(UNKNOWN_PREFIX.length).split(', ').map((name) => name.toLowerCase()))
    : new Set()

const moneyText = ({ gold, silver, copper }: GmMailRequest['money']) =>
  COINS.map(([key, label]) => [{ gold, silver, copper }[key], label] as const)
    .filter(([amount]) => amount > 0)
    .map(([amount, label]) => `${amount} ${label}`)
    .join(' ') || 'none'

function MailPage() {
  const [audience, setAudience] = useState<GmMailAudience>('names')
  const characters = useQuery(gmCharactersQueryOptions)
  const [recipients, setRecipients] = useState<string[]>([])
  const [pending, setPending] = useState('')
  const [sender, setSender] = useState('[GM]')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [items, setItems] = useState<ItemRow[]>([])
  const [picking, setPicking] = useState(false)
  const [money, setMoney] = useState({ gold: 0, silver: 0, copper: 0 })
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ request: GmMailRequest; names: string[] } | null>(null)
  const [results, setResults] = useState<GmMailResult[] | null>(null)
  const [unknown, setUnknown] = useState<Set<string>>(new Set())
  const send = useSendMail()
  // isPending only disables Confirm after a re-render, so two clicks in one tick would both send.
  const sending = useRef(false)

  function review() {
    setProblem(null)
    setResults(null)
    let names: string[]
    if (audience === 'names') {
      // A name still being typed counts.
      const typed = pending
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
      names = withNames(recipients, typed, characters.data)
      if (pending.trim()) {
        setRecipients(names)
        setPending('')
      }
      if (names.length === 0) return setProblem('Add at least one recipient.')
    } else {
      names = audienceNames(audience, characters.data)
      if (names.length === 0) {
        return setProblem(audience === 'online' ? 'No one is online right now.' : 'No characters found.')
      }
    }
    if (!title.trim()) return setProblem('Add a title.')

    const parsed = gmMailRequestSchema.safeParse({
      audience,
      recipients: audience === 'names' ? names : [],
      sender,
      title,
      message,
      money,
      items: items.map(({ item, count }) => ({ itemId: item.itemId, count })),
    })
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return setProblem(`${issue.path.join(' ') || 'Mail'}: ${issue.message}`)
    }
    setConfirming({ request: parsed.data, names })
  }

  async function confirm() {
    if (!confirming || sending.current) return
    sending.current = true
    try {
      const response = await send.mutateAsync(confirming.request)
      setResults(response.results)
      setUnknown(new Set())
      if (confirming.request.audience === 'names') {
        // Delivered recipients leave the list, so a resend only reaches the ones that failed.
        const delivered = new Set(
          response.results.filter((r) => r.postId !== null).map((r) => r.name.toLowerCase()),
        )
        setRecipients((current) => current.filter((name) => !delivered.has(name.toLowerCase())))
      } else {
        // Never leave a bulk send selected: going back to names with only the failures makes a repeat harmless.
        setAudience('names')
        setRecipients(response.results.filter((r) => r.postId === null).map((r) => r.name))
      }
      setConfirming(null)
      void characters.refetch()
    } catch (err) {
      setConfirming(null)
      setUnknown(unknownNames(err))
      setProblem(errorMessage(err))
    } finally {
      sending.current = false
    }
  }

  const bulk = confirming !== null && confirming.request.audience !== 'names'
  const letters = confirming ? `${confirming.names.length} ${confirming.names.length === 1 ? 'letter' : 'letters'}` : ''

  const itemName = (id: number) => {
    const row = items.find(({ item }) => item.itemId === id)
    return row ? itemDisplayName(row.item) : `Item #${id}`
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <GmNav />
      <h1 className="text-4xl">Mail</h1>
      <p className="mt-2 text-sm text-muted">
        Sends an in-game letter to each recipient. Online players see it the next time they open their mailbox.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <MailRecipients
          audience={audience}
          onAudienceChange={(next) => {
            setAudience(next)
            setProblem(null)
          }}
          characters={characters.data}
          recipients={recipients}
          onRecipientsChange={setRecipients}
          pending={pending}
          onPendingChange={setPending}
          unknown={unknown}
        />
        {characters.isError && (
          <p className="text-sm text-muted">Could not load the character list. You can still type names.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mail-sender" className={labelText}>
              Sender
            </label>
            <input id="mail-sender" value={sender} onChange={(event) => setSender(event.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mail-title" className={labelText}>
              Title
            </label>
            <input id="mail-title" value={title} onChange={(event) => setTitle(event.target.value)} className={field} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="mail-message" className={labelText}>
            Message
          </label>
          <textarea
            id="mail-message"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className={field}
          />
        </div>

        <section className="flex flex-col gap-2">
          <h2 className={labelText}>Items</h2>
          {items.length === 0 && <p className="text-sm text-muted">No items attached.</p>}
          {items.map(({ item, count }, index) => {
            const name = itemDisplayName(item)
            return (
              <div key={`${item.itemId}-${index}`} className="flex items-center gap-3">
                <GameIcon spriteId={item.icon} size={32} />
                <span className="min-w-0 flex-1 text-sm">
                  {name} <span className="text-muted">#{item.itemId}</span>
                </span>
                <input
                  type="number"
                  aria-label={`Count for ${name}`}
                  min={1}
                  max={Math.max(item.stack, 1)}
                  value={Number.isNaN(count) ? '' : count}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((row, i) => (i === index ? { ...row, count: event.target.valueAsNumber } : row)),
                    )
                  }
                  className={`${field} w-24`}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Remove item ${name}`}
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            )
          })}
          {picking ? (
            <MailItemPicker
              onPick={(item) => {
                setItems((current) => [...current, { item, count: 1 }])
                setPicking(false)
              }}
              onClose={() => setPicking(false)}
            />
          ) : (
            items.length < MAIL_MAX_ITEMS && (
              <div>
                <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                  Add item
                </Button>
              </div>
            )
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={labelText}>Money</h2>
          <div className="flex flex-wrap gap-4">
            {COINS.map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label htmlFor={`mail-${key}`} className="text-sm">
                  {label}
                </label>
                <input
                  id={`mail-${key}`}
                  type="number"
                  min={0}
                  value={Number.isNaN(money[key]) ? '' : money[key]}
                  onChange={(event) => setMoney((current) => ({ ...current, [key]: event.target.valueAsNumber }))}
                  className={`${field} w-28`}
                />
              </div>
            ))}
          </div>
        </section>

        <FormMessage message={problem} />

        {confirming ? (
          <section
            role="dialog"
            aria-labelledby="mail-confirm-title"
            className="flex flex-col gap-3 rounded-xs border border-accent bg-surface-raised p-4"
          >
            <h2 id="mail-confirm-title" className="text-xl">
              Send this mail?
            </h2>
            {bulk && (
              <p className="text-sm font-bold text-accent-text">
                This sends {letters} {confirming.request.audience === 'online' ? 'letters to everyone online' : 'letters to every character'}
                . Who is online is checked again at send time.
              </p>
            )}
            <dl className="grid grid-cols-[6rem_1fr] gap-1 text-sm">
              <dt className="text-muted">To</dt>
              <dd>{confirming.names.join(', ')}</dd>
              <dt className="text-muted">Title</dt>
              <dd>{confirming.request.title}</dd>
              <dt className="text-muted">Items</dt>
              <dd>
                {confirming.request.items.length
                  ? confirming.request.items.map((item) => `${itemName(item.itemId)} x${item.count}`).join(', ')
                  : 'none'}
              </dd>
              <dt className="text-muted">Money</dt>
              <dd>{moneyText(confirming.request.money)}</dd>
            </dl>
            <div className="flex gap-2">
              <Button onClick={() => void confirm()} disabled={send.isPending}>
                {bulk ? `Send ${letters}` : 'Confirm'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(null)} disabled={send.isPending}>
                Cancel
              </Button>
            </div>
          </section>
        ) : (
          <div>
            <Button onClick={review}>Send</Button>
          </div>
        )}

        {results && (
          <section aria-label="Results" className="flex flex-col gap-1">
            <h2 className={labelText}>Results</h2>
            <ul className="text-sm">
              {results.map((result) => (
                <li key={result.name} className={result.postId === null ? 'text-danger' : undefined}>
                  {result.postId === null ? `${result.name}: ${result.error}` : `${result.name}: sent (post ${result.postId})`}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
