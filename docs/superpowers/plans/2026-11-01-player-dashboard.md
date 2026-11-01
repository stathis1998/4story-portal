# Player Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fun stats for players after login: personal progress, badges and a Hall of Fame, from data the game already stores, with portal data in its own SQLite file.

**Architecture:** `StatsRepository` reads game rows, pure functions in `stats-rules.ts` compute stats and badges, `StatsService` caches them and shapes responses, and `PortalStore` wraps `node:sqlite`. The web adds a richer `/characters`, `/characters/$id` and `/hall-of-fame`.

**Tech Stack:** NestJS 12, mssql, node:sqlite, Zod 4, React 19, TanStack Router and Query, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-player-dashboard-design.md`. Section 3 defines every stat.

## Global Constraints

- Work in `.worktrees/player-dashboard` on `feat/player-dashboard`. Never send requests to ports 3000 or 5173, and never log in as `portal` to the real control server.
- The game databases are only read by this feature. Manual runs use the `_TEST` names. No game source, server or client changes.
- `PORTAL_DB_FILE` is optional with a default, because the user's `.env` won't have it.
- Commit messages follow the repo style and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- API style: 2 spaces, semicolons, `.js` import suffixes. Web style: no semicolons, single quotes, no import suffixes.
- After changing `packages/shared`, run `npm run build -w packages/shared` before running API or web tests directly.

## Review Focus

1. **The player who has just created a character, or has none:** zeros and friendly empty states, never a crash or a blank page. Test in Tasks 3, 6, 7.
2. **Another player's character ID in the URL:** the same 404 as one that doesn't exist. Test in Task 5.
3. **A session open right now, or a character logging in at the moment of creation:** the open one is ignored, the other counted. Test in Task 3.
4. **A corrupt or unwritable SQLite file:** stats still load, the switch says it failed. Test in Tasks 2, 5.
5. **Hidden GMs:** absent from every ranked list and rarity count for everyone, while their own stats still show. Test in Task 5.

---

### Task 1: Shared types and config

**Files:** Create `packages/shared/src/player-stats.ts`, test beside it. Modify `packages/shared/src/index.ts`, `apps/api/src/config/config.ts`, `.env.example`, `apps/api/test/config.test.ts`.

**Produces:** `characterIdSchema`, `hallOfFameSettingsSchema`, types `PlayerOverview`, `CharacterStats`, `BadgeView`, `CharacterProfile`, `HallOfFame`, `ActiveEvents`; `config.portalDbFile`.

- [ ] Failing tests: the schemas; `PORTAL_DB_FILE` defaults to `./data/portal.sqlite` when absent.
- [ ] Implement, watch them pass, commit `feat(shared): player stat types`.

### Task 2: SQLite store

**Files:** Create `apps/api/src/store/portal-store.ts`, `apps/api/src/store/store.module.ts`, `apps/api/test/portal-store.test.ts`.

**Produces:** `PortalStore(file, logger?)` with `hideGms(): boolean`, `setHideGms(value, changedBy): void` (throws `StoreUnavailableError`), `recordBadges(held: Map<number, string[]>, today: string): void`, `badgeUnlocks(): { userId, badgeId, firstSeen: string | null }[]`, `close()`.

- [ ] Failing tests: default false; set then get; survives reopening a file; change history row; first recording blank dates, later ones dated, existing rows unchanged; a badge no longer held stays recorded; unopenable path gives defaults and `setHideGms` throws, without throwing at construction.
- [ ] Implement with `PRAGMA user_version` migrations and transactions. `mkdirSync` the folder. Commit `feat(api): portal SQLite store`.

### Task 3: Stat rules

**Files:** Create `apps/api/src/stats/stats-rules.ts`, `apps/api/test/stats-rules.test.ts`.

**Produces:** types for the input rows, `computeStats(rows, today): ComputedStats` holding per-character and per-account stats, `earnedBadges`, `BADGES`, `rankCategory`.

- [ ] Failing tests for each definition in spec section 3: 12-hour cap; open session ignored; session before creation ignored but one in the creation minute counted; midnight crossing; streak ending today, yesterday, and two days ago; combined account days; night owl boundary at 04:59 and 05:00; exp progress, and null with no chart row; each badge at and just under its threshold; `geared` needing all six slots on one character; ties 1, 1, 3; zeros dropped; a character with no sessions.
- [ ] Implement, commit `feat(api): player stat rules`.

### Task 4: Repository

**Files:** Create `apps/api/src/stats/stats.repository.ts`, `apps/api/test/db/stats.db.test.ts`. Modify table names in `db.service.ts`.

**Produces:** `StatsRepository.loadRows(): Promise<StatRows>`, `STATS_REPOSITORY`.

- [ ] Failing DB test against `_TEST`: returns live characters only, and the rows join; title names are strings. Add a `FakeStatsRepository` to `test/fakes.ts`.
- [ ] Implement with read-only queries. `CAST(strTitle AS varchar(100))`. Run with the `_TEST` names. Commit `feat(api): player stats repository`.

### Task 5: Service and routes

**Files:** Create `apps/api/src/stats/stats.service.ts`, `active-events.service.ts`, `stats.controller.ts`, `stats.module.ts`, `apps/api/test/stats.http.test.ts`. Modify `app.module.ts`, `test/test-app.ts`, `events.service.ts` (export `toGmEvent`).

**Produces:** the routes in spec section 5.

- [ ] Failing HTTP tests: 401 on all routes, 403 on the setting for a non-GM; overview for a player and for one with no characters; profile 404 for another's character and a missing one, 400 for a bad ID; Hall of Fame top 3, ties, your place, banned left out; **the body contains no account name and no gold**; hiding removes GMs from lists and rarity at once, the GM sees `ranked: false` and still their own stats; only GMs get the switch state; a store failure gives 503 on the switch and stats still work; 60-second cache and a shared load; new and first-to-earn flags; active events filter, 30-second cache, control failure gives an empty list, daily end is today's window.
- [ ] Implement, commit `feat(api): player stats routes`.

### Task 6: Characters page

**Files:** Create `apps/web/src/lib/stats.ts`, `components/stats/EventBanner.tsx`, `AccountSummary.tsx`, `ActivityCalendar.tsx`, `BadgeGrid.tsx`. Modify `CharacterCard.tsx`, `routes/_authed/characters.tsx`, `routes/_authed.tsx`, tests.

- [ ] Failing tests: banner with and without events, and a map; summary numbers; calendar cells with labels, using the server's date; badges with rarity, New and First to earn, and locked ones dimmed; cards with progress and a link; stats failing still shows the cards; existing tests keep passing.
- [ ] Implement, commit `feat(web): player overview on the characters page`.

### Task 7: Character page and Hall of Fame

**Files:** Create `routes/_authed/characters.$id.tsx`, `routes/_authed/hall-of-fame.tsx`, `components/stats/GearGrid.tsx`, `HallCategory.tsx`, tests. Modify `README.md`.

- [ ] Failing tests: gear with icon and `+24`, an item with no name; empty gear, companions and titles; rankings; another's character shows the not found message; Hall of Fame lists, marks and your place; GM sees the switch and others don't; switching calls the route and refreshes; failure message; hidden GM sees "GM, not ranked"; retry on failure.
- [ ] Implement, add the README section, run `npm test`, `npm run lint` and `npm run build`. Commit `feat(web): character page and Hall of Fame`.
