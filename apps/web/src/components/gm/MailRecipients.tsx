import { type GmMailAudience, type GmMailCharacter, MAIL_MAX_RECIPIENTS } from '@4story-portal/shared'
import type { KeyboardEvent } from 'react'
import { audienceNames, withNames } from '../../lib/mail-recipients'
import { Tabs } from '../Tabs'

type Props = {
  audience: GmMailAudience
  onAudienceChange: (audience: GmMailAudience) => void
  /** Undefined while loading or when the list could not be loaded; typing names still works then. */
  characters: GmMailCharacter[] | undefined
  recipients: string[]
  onRecipientsChange: (names: string[]) => void
  pending: string
  onPendingChange: (text: string) => void
  /** Lowercased names the server did not find. */
  unknown: ReadonlySet<string>
}

const MAX_MATCHES = 8

const field =
  'rounded-xs border border-line bg-surface-raised px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent'

const splitNames = (text: string) =>
  text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

export function MailRecipients(props: Props) {
  const { audience, onAudienceChange, characters, recipients, onRecipientsChange, pending, onPendingChange, unknown } =
    props
  const online = characters?.filter((c) => c.online).length
  const tabs = [
    { id: 'names', label: 'Choose names' },
    { id: 'online', label: online === undefined ? 'Everyone online' : `Everyone online (${online})` },
    { id: 'all', label: characters === undefined ? 'All characters' : `All characters (${characters.length})` },
  ]

  const search = pending.trim().toLowerCase()
  const chosen = new Set(recipients.map((n) => n.toLowerCase()))
  const matches = search
    ? (characters ?? [])
        .filter((c) => c.name.toLowerCase().includes(search) && !chosen.has(c.name.toLowerCase()))
        .slice(0, MAX_MATCHES)
    : []

  function add(names: string[]) {
    onRecipientsChange(withNames(recipients, names, characters))
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const exact = characters?.some((c) => c.name.toLowerCase() === search)
    add(exact || matches.length === 0 ? splitNames(pending) : [matches[0].name])
    onPendingChange('')
  }

  function onChange(value: string) {
    if (!value.includes(',')) return onPendingChange(value)
    const last = value.lastIndexOf(',')
    add(splitNames(value.slice(0, last)))
    onPendingChange(value.slice(last + 1))
  }

  const reached = audienceNames(audience, characters)

  return (
    <section className="flex flex-col gap-2">
      <Tabs tabs={tabs} active={audience} onChange={(id) => onAudienceChange(id as GmMailAudience)} />
      <div role="tabpanel" id={`panel-${audience}`} aria-labelledby={`tab-${audience}`} className="flex flex-col gap-2 pt-2">
        {audience === 'names' ? (
          <>
            <label htmlFor="mail-recipients" className="text-xs font-bold tracking-wider text-muted uppercase">
              Recipients
            </label>
            {recipients.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {recipients.map((name) => {
                  const missing = unknown.has(name.toLowerCase())
                  return (
                    <li
                      key={name}
                      className={`flex items-center gap-1 rounded-xs border px-2 py-1 text-sm ${
                        missing ? 'border-danger bg-danger-surface text-danger' : 'border-line bg-surface-raised'
                      }`}
                    >
                      {name}
                      {missing && <span className="text-xs">(not found)</span>}
                      <button
                        type="button"
                        aria-label={missing ? `Remove ${name} (not found)` : `Remove ${name}`}
                        className="px-1 text-muted hover:text-danger"
                        onClick={() => onRecipientsChange(recipients.filter((n) => n !== name))}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <input
              id="mail-recipients"
              value={pending}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKey}
              placeholder="Search a character, then click it or press Enter"
              autoComplete="off"
              disabled={recipients.length >= MAIL_MAX_RECIPIENTS}
              className={field}
            />
            {matches.length > 0 && (
              <ul aria-label="Matching characters" className="flex flex-col gap-1">
                {matches.map((c) => (
                  <li key={c.charId}>
                    <button
                      type="button"
                      onClick={() => {
                        add([c.name])
                        onPendingChange('')
                      }}
                      className="flex w-full items-center gap-2 rounded-xs border border-line bg-surface-raised px-3 py-1.5 text-left text-sm hover:border-accent"
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-2 w-2 rounded-full ${c.online ? 'bg-accent' : 'bg-line'}`}
                      />
                      <span className="font-bold">{c.name}</span>
                      <span className="text-muted">
                        Lv {c.level} {c.className}
                        {c.online ? ' · online' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : reached.length === 0 ? (
          <p className="text-sm text-muted">
            {audience === 'online' ? 'No one is online right now.' : 'No characters found.'}
          </p>
        ) : (
          <p className="text-sm">
            Sends one letter to each of these {reached.length} characters when you confirm:{' '}
            <span className="text-muted">{reached.join(', ')}</span>
          </p>
        )}
      </div>
    </section>
  )
}
