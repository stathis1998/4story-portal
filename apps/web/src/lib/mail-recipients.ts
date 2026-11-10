import { type GmMailAudience, type GmMailCharacter, MAIL_MAX_RECIPIENTS } from '@4story-portal/shared'

/** The characters an audience reaches, as the page currently knows them. */
export function audienceNames(audience: GmMailAudience, characters: GmMailCharacter[] | undefined): string[] {
  const list = characters ?? []
  return (audience === 'online' ? list.filter((c) => c.online) : list).map((c) => c.name)
}

/** Adds names, skipping duplicates and stopping at the limit. Uses the stored spelling when the character is known. */
export function withNames(current: string[], names: string[], characters: GmMailCharacter[] | undefined): string[] {
  const next = [...current]
  for (const raw of names) {
    const name = characters?.find((c) => c.name.toLowerCase() === raw.toLowerCase())?.name ?? raw
    if (next.length < MAIL_MAX_RECIPIENTS && !next.some((n) => n.toLowerCase() === name.toLowerCase())) next.push(name)
  }
  return next
}
