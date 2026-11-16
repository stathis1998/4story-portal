# Slots Cascades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The five-reel slots gain cascades with a step multiplier, free rounds with a climbing multiplier and retriggers, a per-account meter, three jackpots (Mini, Major, Giga), a 105% long-run payback, a 5 Gold stake cap and a daily limit of 1,500 rounds.

**Architecture:** The cascade chain is a pure function of the five stops (refills come from the strip above), so the shared package plays and replays whole rounds and counts every window exactly; free rounds and the meter are valued by an exact dynamic programme over buckets kept by the count. The API reads the account's meter, plays the round from drawn stops and pays it in the existing one-transaction money step, which gains a game "check" hook (daily limit, meter unchanged) and a three-pot jackpot step. The page replays every chain from the stops and shows it step by step.

**Tech Stack:** NestJS + mssql + zod (API), React 19 + TanStack Router/Query + Tailwind (web), Web Audio, vitest, SQL Server.

**Spec:** `docs/superpowers/specs/2026-11-15-slots-cascades-design.md`. Read it first, then the two it changes: `docs/superpowers/specs/2026-11-15-slots-modern-design.md` and `docs/superpowers/specs/2026-11-15-slots-jackpot-design.md`. The code to read: `packages/shared/src/slots.ts`, `slot-rules.ts`, `slot-count.ts`, `slot-figures.ts`, `slot-machines.ts` and their tests; `apps/api/src/slots/`, `apps/api/src/games/wallet-bet.ts`, `apps/api/sql/TPORTALSLOTSPIN.sql`, `apps/api/sql/TPORTALSLOTJACKPOT.sql`, `apps/api/test/fakes.ts` (`FakeSlotsRepository`), `apps/api/test/slots.http.test.ts`, `apps/api/test/db/slots.db.test.ts`; `apps/web/src/lib/slot-round.ts`, `apps/web/src/lib/use-slot-round.ts`, `apps/web/src/lib/slot-sounds.ts`, `apps/web/src/lib/slots.ts`, `apps/web/src/components/slots/`, `apps/web/src/routes/_authed/slots.tsx`, `apps/web/src/routes/_authed/gm/slots.tsx` and their tests. Copy their patterns unless this plan says otherwise.

## Global Constraints

- **Never edit or print `.env`.** It names the live databases. DB tests run only through a wrapper that loads the main checkout's `.env` with dotenv and then forces `DB_GLOBAL_NAME=TGLOBAL_GSP_TEST` and `DB_GAME_NAME=TGAME_GSP_TEST` (an earlier one lived at `C:/Users/stath/AppData/Local/Temp/claude/4b311fab728d2cb9/b286bea3-ec79-477d-b753-b5e3a5345e30/scratchpad/rundb.mjs`; read it before using it, and point its paths at this worktree). Never weaken `apps/api/test/db/guard.setup.ts`.
- **Never run SQL against `TGAME_GSP` or `TGLOBAL_GSP`.** Only the `_TEST` copies, and DB tests roll everything back. Applying the script anywhere else waits for the owner.
- **No dev servers, no `nest build`, no browsers** except the single watched browser check in Task 11. Vitest only, affected files only, `--maxWorkers=2`. This machine is a small VM hosting live game servers.
- **Run every test command from a path spelled with a capital `C:`.** From a lowercase `c:` path vitest fails every file with "failed to find the current suite".
- `@4story-portal/shared` is consumed from `dist`: run `npm run build -w packages/shared` after changing it and before API or web tests. Tasks 1 to 3 change only `packages/shared`; the API's and the web's tests go red when `dist` is rebuilt at the end of Task 3 and come back in Tasks 4 and 5 (API) and 6 to 11 (web).
- Money on the wire is whole **Silver** (1 Gold = 1000 Silver). In the database money is **Bronze** in `BIGINT`; the driver returns `BIGINT` as a string.
- **The line stake is `stake / SLOT_LINE_COUNT`** (20). Every multiplier is a whole number, so every win stays whole Silver.
- **Cascade:** winning tiles (within each winning line's paying count) burst, a tile on two lines bursts once, wilds that helped burst, scatters never burst; each reel's survivors slide down keeping their order and the gaps at the top fill with that reel's strip positions `p - k ... p - 1`, where `p` is the strip position of its top row and `k` the tiles it lost. A chain ends at the first step that wins nothing or after **12 steps**.
- **Paid spin step multiplier:** step `j` (1-based) pays times `min(j, 5)`.
- **Free round:** starts at times **2**; every winning step pays at the current multiplier and then raises it by 1, up to times **10**; carried across the round. Free spins come from the scatters in the paid spin's **last** window: 3, 4, 5 or more give 8, 12, 20. A free spin whose last window shows 3 or more scatters adds **5** spins, but never past **50** in the round (it adds what fits).
- **Meter:** a paid spin whose last window shows 1 or 2 scatters adds that many points, unless it won free spins. At the machine's `meterSize` it pays **8** free spins (a free round from times 2, same 50 limit, can retrigger) played straight after that paid spin, and keeps the points over the size. One meter per account, machine and stake.
- **Three jackpots:** Mini (pot row 2), Major (row 3), Giga (row 1, today's pot). Shares 30 / 30 / 40 per cent of the jackpot money; starting caps 1, 10 and 50 Gold; the caps must rise Mini < Major < Giga. Only a lost round (nothing paid in the whole round) feeds or wins them. Each pot draws on its own with `slotJackpotDrops`.
- **Total payback 105%** long-run: the jackpot share is `max(0, floor((1.05 - R) / L x 1e9) - 1)` billionths of a lost stake. `R` (reels, free spins, meter) between 100% and 102% on every machine.
- **Stakes:** multiples of 20 Silver, from 20 Silver to **5 Gold (5,000 Silver)**.
- **Daily limit:** 1,500 rounds per account per database day (all machines, all rules), GM-settable from 100 to 10,000.
- A win smaller than the stake is never celebrated. Nothing sounds before the player's first press. Nothing on screen or in the sound gives a step's result away before that step is shown. Spin rests 400 ms after every round. One press is one round.
- The game calls the coins Gold, Silver and Bronze in everything a person reads. Code and columns keep `copper` / `dwCooper`.
- UI copy is plain ASCII punctuation, sentence case, no exclamation marks. Exact strings in this plan are verbatim.
- Roulette's tests pass unchanged.
- Commits: `feat:` / `fix:` / `test:` / `refactor:` / `docs:` prefix, ending with the `Co-Authored-By:` line the committing session is given. Work on branch `feat/slots-cascades` in `.worktrees/slots-cascades`, never on `main`.

## Review Focus

1. **The meter moved between the API's read and the money step** (two tabs or two characters of one account on the same machine and stake): refused with `Your meter changed. Press Spin again.`, nothing moved, the page reloads the state and the next press plays. (Tasks 4, 5, 9)
2. **The new API against a database without this change's SQL:** the page opens (the Giga pot reads from row 1, Mini and Major show as unavailable), every spin is refused with `Slots are not available right now` and nothing is taken. (Tasks 4, 5)
3. **Setting rows from before the change:** stakes above 5 Gold, a cap row that does not parse, or Mini/Major/Giga caps out of order: each falls back to its starting value, never a broken page or a refused page load. (Task 4)
4. **A round at the limits:** a chain that reaches 12 steps, a free round that reaches 50 spins, meter free spins after a paid spin: the row holds every stop, the replay from the row and from the answer gives the same payout as the API paid. (Tasks 1, 4, 5, 6)
5. **Round 1,500 of the day pressed twice, or from two tabs:** exactly one plays; the next is refused with the daily message and nothing drawn or moved; the page shows `0 rounds left today` and Spin off. (Tasks 4, 5, 9)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/slots.ts` | Constants, types, schemas, API views (three pots, meters, daily limit, 5 Gold cap) |
| `packages/shared/src/slot-rules.ts` | Lines on any grid, the cascade chain, playing and replaying a round, free text |
| `packages/shared/src/slot-count.ts` | Counting every window through its chain into buckets. Not exported from `index.ts` |
| `packages/shared/src/slot-figures.ts` | Free round value and blank chance (dynamic programme), return, lost rate, rates, largest win, jackpot share and the three adds |
| `packages/shared/src/slot-machines.ts` | The three machines: symbols, strips, prizes, `meterSize`, counts, rest |
| `apps/api/sql/TPORTALSLOTSPIN.sql`, `TPORTALSLOTJACKPOT.sql`, new `TPORTALSLOTMETER.sql` | Columns, pot rows 2 and 3, the meter table, the daily index |
| `apps/api/src/games/wallet-bet.ts` | The money batch gains a game `check` step that may refuse with a game code |
| `apps/api/src/slots/` | Settings (pots, daily limit), meter read, the round, three pots, refusals, GM routes |
| `apps/web/src/lib/slot-round.ts` | A round as spins and steps to show, tiers, lines in words |
| `apps/web/src/components/slots/Reels.tsx` | Draws a cascade step's grid: bursts and falls |
| `apps/web/src/lib/slot-sounds.ts` | New sounds: `burst`, `retrigger`, `meterPoint`, `meterFull`, `jackpotMini`, `jackpotMajor` |
| `apps/web/src/lib/use-slot-round.ts` | The show, now step by step |
| `apps/web/src/components/slots/JackpotMeters.tsx` (replaces `JackpotBanner.tsx`), `MeterBar.tsx` | Three pots; the player's meter |
| `apps/web/src/components/slots/PayTable.tsx` | Cascades, multipliers, meter, pots, the counted figures |
| `apps/web/src/routes/_authed/slots.tsx`, `_authed/gm/slots.tsx` | The player page; the GM page |

---

### Task 1: Cascades, rounds and the new shared types

**Files:**
- Modify: `packages/shared/src/slots.ts`, `slots.test.ts`, `slot-rules.ts`, `slot-rules.test.ts`, `index.ts`
- Commit also: the plan

**Interfaces. Produces** (in `slots.ts`; existing names not listed stay):

```ts
export const SLOT_MAX_STAKE = 5_000;                    // was 100_000
export const SLOT_CHAIN_MAX = 12;
export const SLOT_STEP_MULTIPLIER_MAX = 5;
export const SLOT_FREE_START = 2;                       // the free round's first multiplier
export const SLOT_FREE_MULTIPLIER_MAX = 10;
export const SLOT_RETRIGGER = 5;
export const SLOT_FREE_MAX = 50;
export const SLOT_METER_FREE = 8;
export const SLOT_TOTAL_RETURN = 1.05;
export const SLOT_RULES_CASCADE = 3;                    // the rules number of a cascade round's row
export const SLOT_DAILY_DEFAULT = 1_500, SLOT_DAILY_MIN = 100, SLOT_DAILY_MAX = 10_000;
// SLOT_FREE_SPINS stays { 3: 8, 4: 12, 5: 20 }; 5 or more scatters read as 5. SLOT_FREE_MULTIPLIER is removed.
export const SLOT_POTS = ['mini', 'major', 'giga'] as const;
export type SlotPot = (typeof SLOT_POTS)[number];
export const SLOT_POT_ROW: Record<SlotPot, number> = { giga: 1, mini: 2, major: 3 };
export const SLOT_POT_SHARE: Record<SlotPot, number> = { mini: 30, major: 30, giga: 40 };   // per cent
export const SLOT_POT_DEFAULT_CAP: Record<SlotPot, number> = { mini: 1, major: 10, giga: 50 }; // whole Gold
export type SlotMachine = { ...today's fields; meterSize: number; counts: SlotCounts };      // SlotCounts: Task 2
export type SlotPotsSettingsInput = Record<SlotPot, { live: boolean; cap: number }>;
export const slotPotsSettingsSchema;   // caps whole Gold 1..10,000, mini.cap < major.cap < giga.cap,
                                        // message 'The caps must rise: Mini below Major below Giga'
export const slotDailySchema;          // { rounds: int SLOT_DAILY_MIN..SLOT_DAILY_MAX }
export type SlotJackpotView = { pot: SlotPot; live: boolean; amount: number; cap: number; floor: number;
                                last: { character: string; amount: number; at: string } | null };   // whole Silver
export type SlotMeterView = { machine: SlotMachineKey; stake: number; points: number };
export type SlotSpinView = { ...today's fields; meterFree: SlotStops[];
                             /** Whole Silver won from each pot; `jackpot` stays their sum. */ pots: Record<SlotPot, number> };
export type SlotsState = { ...today's fields except jackpot;
                           /** Empty when the pots cannot be read; otherwise all three, Mini first. */ jackpots: SlotJackpotView[];
                           meters: SlotMeterView[]; daily: { limit: number; played: number } };
export type SlotSpinResult = { spin: SlotSpinView; wallet: Wallet; state: SlotsState; meter: SlotMeterView };
export type GmSlots: `jackpot` becomes `jackpots: GmSlotPot[]` (today's GmSlotJackpot fields plus `pot: SlotPot`), plus `daily: { limit: number }`.
```

`parseSlotStakes`, `slotSpinRequestSchema` and `slotMachineSettingsSchema` use the new `SLOT_MAX_STAKE`; their message is unchanged. `slotJackpotSettingsSchema`, `SlotJackpotSettingsInput`, `SlotJackpot`, `GmSlotJackpot` and `SLOT_JACKPOT_DEFAULT_CAP` are removed in favour of the pot types above; `SLOT_JACKPOT_MIN_CAP`, `SLOT_JACKPOT_MAX_CAP`, `SLOT_JACKPOT_ROLLS` and `slotJackpotDrops` stay.

**In `slot-rules.ts`:**

```ts
/** [reel][row] symbol indexes; row 0 top. */
export type SlotGrid = number[][];
/** What 20 lines and the scatters read on any grid. `multiple` in line stakes, no multiplier. */
export function slotLinesOn(machine: SlotMachine, grid: SlotGrid): { lines: SlotLineWin[]; multiple: number; scatters: number };
export type SlotStep = {
  grid: SlotGrid;
  lines: SlotLineWin[];
  /** Line stakes this step's lines pay, before any multiplier. */
  multiple: number;
  /** The tiles that burst, [reel, row], each once, reel then row. Empty for the step that ends the chain. */
  burst: [number, number][];
  /** How many rows each tile of this grid fell to reach its place: [reel][row]. All 0 on step 1. */
  drop: number[][];
};
/** Every step read, the last one winning nothing unless the chain hit SLOT_CHAIN_MAX. */
export type SlotChain = { steps: SlotStep[]; scatters: number; capped: boolean };
export function slotChain(machine: SlotMachine, stops: SlotStops): SlotChain;
/** A paid spin's chain, in line stakes: the sum over steps of multiple x min(step, 5). */
export function slotPaidChainPay(chain: SlotChain): number;
export type SlotRoundPlay = {
  stops: SlotStops; free: SlotStops[]; meterFree: SlotStops[];
  /** Line stakes the whole round pays; Silver is this x stake / SLOT_LINE_COUNT. */
  lineStakes: number;
  meterBefore: number; meterAfter: number;
};
/** Plays a round, drawing stops as the rules need them, in the spec's draw order. */
export function slotPlayRound(machine: SlotMachine, meterBefore: number, draw: () => SlotStops): SlotRoundPlay;
/** Plays a recorded round again; throws if the record has too few or too many stops for what the rules play. */
export function slotReplayRound(machine: SlotMachine, round: Pick<SlotRoundPlay, 'stops' | 'free' | 'meterFree' | 'meterBefore'>): SlotRoundPlay;
// slotFreeText / parseSlotFree accept up to SLOT_FREE_MAX spins. slotSpin and slotRoundPayout are removed.
```

`slotWindow` stays. A free round's play, shared by scatter free spins and meter free spins: `left = n, total = n, m = SLOT_FREE_START`; while `left > 0`: draw, play the chain, for each winning step add `multiple x m` then `m = min(m + 1, 10)`; if the last window shows 3 or more scatters, `add = min(SLOT_RETRIGGER, SLOT_FREE_MAX - total)`, `left += add, total += add`; `left -= 1`. Meter: points `k` are the paid spin's last-window scatters when that is 1 or 2 and it won no free spins, else 0; `after = before + k`; if `after >= meterSize`: play `SLOT_METER_FREE` meter free spins and `after -= meterSize`.

- [ ] **Step 1: Write the failing tests** in `slot-rules.test.ts`, on the `showing(...)` fixture (extend it: `showing` takes whole strips per reel when a test needs to control what falls in, and a `meterSize`; prizes `pays[i] = [5, 20, 100] x (i + 1)`, `twoLucky = 2`):

```ts
it('reads lines and scatters on any grid', ...)                        // slotLinesOn on a hand grid equals today's slotSpin results on the same window
it('ends after one step when nothing wins', ...)                      // steps.length 1, burst [], capped false
it('bursts a winning line and refills from the strip above', ...)
// reel strips chosen so the line-1 win on step 1 bursts the middle row of reels 1-3; on those reels step 2's grid is
// [strip[p-1], old row 0, old row 2] (survivors slide down keeping their order, the new letter on top) and drop is
// [1, 1, 0]; reels 4 and 5 are unchanged with drop [0, 0, 0]
it('bursts a tile on two lines once', ...)
it('bursts a wild that helped a line', ...)
it('never bursts a scatter, so scatters only stay or grow', ...)
it('pays each step times its step, then 5 from step 5 on', ...)       // slotPaidChainPay with steps of multiple 10: 10, 10+20, ..., step 6 adds 50
it('stops after 12 steps and says so', ...)                            // a fixture whose strips keep winning: steps.length 12, capped true
it('plays free spins from the last window, not the first', ...)        // a scatter falls in on step 2: 3 scatters, 8 free spins drawn
it('climbs the free multiplier from 2 to 10 across the round', ...)
it('retriggers 5 spins and never passes 50', ...)                      // a fixture where every free spin retriggers: free.length 50 exactly
it('fills the meter from 1 or 2 scatters, plays 8 free spins when full and keeps the rest', ...)
// meterSize 3, before 2, a paid spin with 2 scatters: meterFree.length 8 (no retrigger), after 1
it('adds no meter points from a paid spin that won free spins', ...)
it('draws in the spec order: paid, free in play order, meter free', ...) // a counting draw() records call order and count
it('replays a recorded round to the same play, and refuses a record with a stop too many or too few', ...)
it('reads and writes up to 50 free spins as text', ...)               // 50 round-trips; 51 is null
```

In `slots.test.ts`: stakes up to `5000` accepted and `5020` refused by all three stake checks; `slotPotsSettingsSchema` accepts `{mini 1, major 10, giga 50}` and refuses `{mini 10, major 10, giga 50}` with the exact message; `slotDailySchema` accepts 100 and 10,000, refuses 99 and 10,001.

- [ ] **Step 2: Run and see them fail.** `cd "C:/.../packages/shared" && npx vitest run src/slot-rules.test.ts src/slots.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement.** Remove `slotSpin`, `slotRoundPayout`, `SLOT_FREE_MULTIPLIER` and their tests; anything else in the shared package that used them follows in Task 2. Do not rebuild `dist`.
- [ ] **Step 4: Run again.** Expected: PASS. `npm run lint -w packages/shared` may still fail only in `slot-count.ts`, `slot-figures.ts`, `slot-machines.ts` and their tests (Tasks 2 and 3); say so in the report.
- [ ] **Step 5: Commit** `feat: slots cascades: chains, free rounds that climb, the meter, and the round played from its stops` (with the plan).

---

### Task 2: Counting every chain, and the exact figures

**Files:**
- Modify: `packages/shared/src/slot-count.ts`, `slot-figures.ts`, `slot-figures.test.ts`, `slots.ts` (the `SlotCounts` type)

**Interfaces.**
- Consumes: `slotChain`, `slotPaidChainPay`, Task 1's constants.
- Produces:

```ts
// slots.ts
export type SlotCounts = {
  /** Windows by scatters in the chain's last window: 0, 1, 2, 3, 4, 5 or more. */
  last: [number, number, number, number, number, number];
  /** Of those, the windows whose chain pays nothing. */
  blankLast: [number, number, number, number, number, number];
  /** Windows by winning steps W (0..12) and whether the last window shows 3+ scatters (r 0/1): index W * 2 + r. */
  free: number[];
  /** Line stakes of step j (0..11) summed over windows with W winning steps and retrigger r: index (W * 2 + r) * 12 + j. */
  steps: number[];
  /** The most one paid spin's chain pays, line stakes. */
  best: number;
  /** The longest chain met, and how many windows reached SLOT_CHAIN_MAX. */
  longest: number;
  capped: number;
};

// slot-count.ts
export function countSlotMachine(machine: Pick<SlotMachine, 'reels' | 'pays' | 'twoLucky'>): SlotCounts;
// quickSlotCounts is removed; the strip search samples instead (Task 3).

// slot-figures.ts
export type FreeRules = { start: number; max: number; retrigger: number; limit: number; stepCap: number };
export const SLOT_FREE_RULES: FreeRules;   // { start: 2, max: 10, retrigger: 5, limit: 50, stepCap: 12 }
/** Expected line stakes a free round of n spins pays, retriggers included. Exact. */
export function slotFreeRoundValue(counts: SlotCounts, n: number, rules?: FreeRules): number;
/** The chance a free round of n spins pays nothing at all. Exact. */
export function slotFreeRoundBlank(counts: SlotCounts, n: number, rules?: FreeRules): number;
export function slotPaidValue(machine: SlotMachine): number;     // E[paid chain pay] in line stakes per round
export function slotMeterRate(machine: SlotMachine): number;     // meter fills per round, long run
export function slotReturn(machine: SlotMachine): number;        // R, without the jackpots
export function slotLostRate(machine: SlotMachine): number;      // L, long run
export function slotFreeRate(machine: SlotMachine): number;      // paid spins that win free spins, per round
export function slotPaysRate(machine: SlotMachine): number;      // 1 - L
export function slotLargestWin(machine: SlotMachine, stakes: SlotStakes): number;   // best x max(stakes) / 20
export function slotJackpotShare(machine: SlotMachine): { num: number; den: number };
/** Bronze a lost round of `stake` Silver adds to each pot, each rounded down. */
export function slotJackpotAdds(machine: SlotMachine, stake: number): Record<SlotPot, number>;
```

The sums, with `C` the number of windows (`32 ** 5` for a real machine), `S = meterSize`, `N = [8, 12, 20]` for 3, 4, 5+ scatters, and `p(W, r) = free[W*2+r] / C`:

```
paid value       sum over W, r, j of steps[(W*2+r)*12+j] x min(j+1, 5) / C
free value V     dynamic programme over (left, m, total):
                 V(left, m, total) = sum over W, r of [ sum_j steps[..][j] x min(m + j, 10) / C
                                      + p(W, r) x V(left - 1 + a, min(m + W, 10), total + a) ],  a = r ? min(5, 50 - total) : 0
                 V(0, ., .) = 0;  slotFreeRoundValue(n) = V(n, 2, n)
blank chance Q   Q(left, total) = sum over r of p(0, r) x Q(left - 1 + a, total + a);  Q(0, .) = 1
meter rate       (last[1] x 1 + last[2] x 2) / (C x S)
R                [ paid + sum_{s=3,4,5+} last[s]/C x V(N_s) + meterRate x V(8) ] / 20
L                blankLast[0]/C + sum_{k=1,2} blankLast[k]/C x (1 - k/S + (k/S) x Q(8)) + sum_{s=3,4,5+} blankLast[s]/C x Q(N_s)
share num        max(0, floor((SLOT_TOTAL_RETURN - R) / L x 1e9) - 1)
pot add          floor(stake x 1000 x num x share% / (1e9 x 100)), BigInt
```

Note `steps` for step `j` of a free spin multiplies by `min(m + j, 10)` with `j` zero-based, matching "pays at the multiplier it finds, then +1". The rules parameter exists so a test can use a tiny rule set and enumerate exactly.

How the count is made fast: build each reel's strip as symbol indexes once; for each window, read step 1 with a precomputed prize table (today's approach), and only when step 1 wins play the chain with typed arrays (no allocation per step). Target: one 32-letter machine in under two minutes on this machine; if slower, stop and report with the measured time before going on.

- [ ] **Step 1: Write the failing tests** in `slot-figures.test.ts`:

```ts
it('counts a small machine exactly as slotChain plays it, window by window', ...)
// strips of length 6 with wilds, scatters and chains (7,776 windows): loop every window through slotChain and
// slotPaidChainPay in the test, build every SlotCounts field by hand, expect countSlotMachine to equal it
it('values a free round exactly: the programme against enumerating every sequence', ...)
// tiny strips (length 4, 1,024 windows) and rules { start: 2, max: 4, retrigger: 1, limit: 3, stepCap: 12 }:
// enumerate all spin sequences up to 3 spins (with retriggers) with slotChain, sum pays with the climbing
// multiplier and blank chances, compare with slotFreeRoundValue / slotFreeRoundBlank to 1e-12
const machine = { ...fixture, meterSize: 30, counts: HAND_COUNTS };   // counts written by hand in the test
it('works out R, L, the rates and the share from the counts', ...)  // each figure from HAND_COUNTS by the formulas above, worked in the test
it('never lets reels and jackpots pay back more than 105%', ...)     // R + L x num / den <= 1.05 and > 1.05 - 3e-9
it('splits the share 30, 30, 40, each rounded down, never more than the whole', ...)
it('gives no share when R is already 105% or more', ...)
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/slot-figures.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement** both files and the `SlotCounts` type.
- [ ] **Step 4: Run again.** Expected: PASS. Measure and report how long `countSlotMachine` takes on one 32-letter fixture.
- [ ] **Step 5: Commit** `feat: count every slots chain and value free rounds and the meter exactly`.

---

### Task 3: The three machines, searched again

**Files:**
- Modify: `packages/shared/src/slot-machines.ts`, `slot-machines.test.ts`

**Interfaces.** Produces `SLOT_MACHINES` and `slotMachine(key)` with the same keys, names and ten symbols per machine (indexes, names and sprites unchanged), new strips, new prizes, a `meterSize`, counts from `countSlotMachine`, and a `rest`.

What each machine must be (the test below is the exact rule):

- **Strips:** 32 letters `A` to `J`; every paying symbol on every reel; `I` (wild) only on reels 2 to 4 and present on each of them; `J` (scatter) on every reel, two on one reel at least 3 stops apart round the loop.
- **Prizes:** three < four < five per symbol; each column rises from symbol 0 to 7; `twoLucky` from 1 to below symbol 0's three.
- **Starting stakes** unchanged: `[20, 40, 60]`, `[40, 60, 100]`, `[60, 100, 200]`.
- **`rest`:** a window whose chain pays nothing, shows no scatter and no wild, with five different symbols on the middle row.
- **Targets:**

| | `R` (reels, free, meter) | A round pays (`1 - L`) | Free spins, once in | Meter fills, once every | `meterSize` |
|---|---|---|---|---|---|
| shelf | 1.00 to 1.02 | 0.50 to 0.62 | 65 to 100 rounds | 45 to 80 rounds | 30 |
| armoury | 1.00 to 1.02 | 0.44 to 0.56 | 90 to 140 | 60 to 110 | 30 to 60 |
| hoard | 1.00 to 1.02 | 0.36 to 0.48 | 110 to 180 | 80 to 140 | 30 to 60 |

  Plus: the Shelf pays most often and the Hoard least; the Hoard's `best` is the largest of the three; `capped` is at most one window in 100,000.

- [ ] **Step 1: Write the failing tests** in `slot-machines.test.ts`: ten distinct symbols per machine with today's names and sprites at indexes 0 to 9 (read them from `git show HEAD:packages/shared/src/slot-machines.ts` once and write them into the test); the strip and prize rules; `countSlotMachine(machine)` equals `machine.counts` (its own file section, timeout 300,000); every band in the table with its exact numbers; `R + L x share <= 1.05` and `> 1.05 - 3e-9`; `slotJackpotAdds` for every starting stake and for 5,000 adds up to no more than `stake x 1000 x (1.05 - R) / L`; the ordering rules; the stakes; the rest rule through `slotChain`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Find the strips, prizes and meter sizes** with a throwaway search script in the session's scratch folder (never committed; a temporary vitest file inside `packages/shared` that prints its result is the simplest runner, deleted before committing). Estimate `R`, `L`, and the two rates by sampling a few hundred thousand random windows through `slotChain` and the figure formulas (`steps`, `last` and `blankLast` from the sample, scaled), hill-climb, then confirm each candidate with the full `countSlotMachine`. One search process at a time, never more than about three minutes per run.
- [ ] **Step 4: Write `slot-machines.ts`** with the found values and the full counts.
- [ ] **Step 5: Run the tests,** then the whole shared suite, `npm run lint -w packages/shared`, and `npm run build -w packages/shared` from the worktree root. Expected: all PASS, lint and build clean.
- [ ] **Step 6: Commit** `feat: three cascade machines that pay back 105% over time, counted`. In the report give, per machine: `R`, the total with jackpots, how often a round pays, free spins once in N, meter fills once every N, `meterSize`, largest win as a multiple of the stake, the share as a percentage, `longest` and `capped`.

---

### Task 4: The database: meters, three pots, the daily limit

**Files:**
- Modify: `apps/api/sql/TPORTALSLOTSPIN.sql`, `apps/api/sql/TPORTALSLOTJACKPOT.sql`, `apps/api/src/games/wallet-bet.ts`, `apps/api/src/slots/slots.repository.ts`, `apps/api/test/fakes.ts`, `apps/api/test/db/slots.db.test.ts`, `apps/api/test/db/roulette.db.test.ts` (only if a shared helper moved), `apps/api/src/db/db.service.ts` (table name)
- Create: `apps/api/sql/TPORTALSLOTMETER.sql`

**Interfaces.**

```ts
// wallet-bet.ts
/** A game's own refusal from its check step: 10 to 99. */
export type GameCode = number;
export function walletBetSql(tables: BetTables, liveKey: string, record: string, before?: string, check?: string): string;
// `check` runs once every shared check has passed and before `before`; it may SET @code to a value from 10 to 99,
// and then nothing is written. It must return no result set. Roulette passes neither and is unchanged.

// slots.repository.ts
export const SLOT_DAILY_REFUSED = 10, SLOT_METER_REFUSED = 11;
export const SLOTS_DAILY_KEY = 'slots_daily_rounds';
export const SLOTS_POT_KEYS: Record<SlotPot, { live: string; cap: string }>;
// giga: today's 'slots_jackpot_live' / 'slots_jackpot_cap'; mini: 'slots_jackpot_mini_live' / '_cap'; major: '..._major_...'
export type SlotSettings = { live; machines; pots: Record<SlotPot, { live: boolean; cap: number }>; daily: number };
export type SlotPotRow = { pot: SlotPot; amount: number; cap: number | null };          // Bronze
export type SlotBetInput = { userId; charId; machine; stops; free; meterFree; stake; payout; multiple;
                             meterBefore: number; meterAfter: number; daily: number;
                             adds: Record<SlotPot, number>; caps: Record<SlotPot, number>;   // Bronze; whole Gold
                             rolls: Record<SlotPot, number> };
export type SlotBetOutcome =
  | { code: typeof BET_OK; id: number; wallet: Wallet; pots: Record<SlotPot, number> /* whole Silver won */ }
  | { code: Exclude<BetCode, typeof BET_OK> | typeof SLOT_DAILY_REFUSED | typeof SLOT_METER_REFUSED; name: string | null };
export interface SlotsRepository {
  // today's methods, with these changes:
  settings(): Promise<SlotSettings>;                 // pots and daily fall back to starting values on a bad or out-of-order row
  savePots(input: SlotPotsSettingsInput, by: string): Promise<void>;
  saveDaily(rounds: number, by: string): Promise<void>;
  pots(): Promise<SlotPotRow[]>;                     // throws when the table cannot be read; Mini and Major missing rows also throw
  meters(userId: number): Promise<SlotMeterView[]>;
  meter(userId: number, machine: SlotMachineKey, stake: number): Promise<number>;   // 0 when no row
  roundsToday(userId: number): Promise<number>;
  jackpotTotals(): Promise<Record<SlotPot, SlotJackpotTotalsRow>>;
  jackpotWins(pot: SlotPot, limit: number): Promise<SlotSpinRow[]>;
}
```

**SQL** (each guarded, safe to run twice, written in the table scripts the DB tests run):
- `TPORTALSLOTSPIN`: `szFree` widened to `VARCHAR(800)`; new `szMeterFree VARCHAR(800) NOT NULL DEFAULT ''`; `llAddMini`, `llAddMajor`, `llAddGiga`, `llWonMini`, `llWonMajor`, `llWonGiga` `BIGINT NOT NULL DEFAULT 0` (Bronze; `llAdded` and `llJackpot` stay as their sums, so older readers keep working); index `IX_TPORTALSLOTSPIN_USER_TIME (dwUserID, dSpun)`.
- `TPORTALSLOTMETER`: `dwUserID INT`, `szMachine VARCHAR(20)`, `dwStake INT` (Silver), `bPoints TINYINT NOT NULL`, `dUpdated DATETIME`, primary key `(dwUserID, szMachine, dwStake)`.
- `TPORTALSLOTJACKPOT`: the check `bID = 1` replaced by `bID BETWEEN 1 AND 3`; rows 2 and 3 inserted empty.

**The bet batch:**
- `check` step: count `dbo.TPORTALSLOTSPIN` rows for `@userId` with `dSpun >= CAST(CAST(GETDATE() AS DATE) AS DATETIME)`; if `>= @daily` set `@code = 10`. Else read the meter row `WITH (UPDLOCK, HOLDLOCK)` for `(@userId, @machine, @meterStake)`; if `ISNULL(points, 0) <> @meterBefore` set `@code = 11`.
- `before` step: write the meter (`MERGE` to `@meterAfter`, skipped when both before and after are 0 and no row exists); then the pots in row order 1, 2, 3, each only when its add is above 0: today's guard (refused unless `@payout = 0`, the add no more than the stake, the roll in range) and today's drop rule, adding each drop's whole Silver to `@extra` and recording that pot's add and win for the row.
- The `INSERT` writes rules `3`, all five stops, `szFree`, `szMeterFree`, the six per-pot amounts and their two sums.
- **Lists** (`spinsOf`, `bigWins`, `latest`, `jackpotWins`) read only rules 3 and leave out a row whose free or meter text does not parse; **totals** count every row of every rules number, as today.

- [ ] **Step 1: Write the failing DB tests** (everything inside the rolled-back transaction, through the wrapper, `_TEST` copies only):

```ts
it('moves the meter with the spin, and only then', ...)                     // before 0 after 2: row written; a refused spin writes no meter
it('refuses a spin whose meter changed, with nothing moved', ...)             // meterBefore 3 against a row of 5: code 11, wallet, row, pots unchanged
it('refuses round 1,501 of the day, with nothing moved', ...)                 // plant 1,500 rows for the account today (and 3 yesterday): code 10
it('counts rows of every rules number toward the daily limit', ...)
it('feeds three pots from one lost round, each by its own add', ...)
it('pays two pots in one round and records each', ...)                         // rolls 0 and caps set so two drop
it('keeps the Giga in row 1 with the pot that was there', ...)
it('records every stop of a 50-spin free round and 8 meter free spins', ...)
it('reads settings back to starting values when a row is out of order or above 5 Gold', ...)
it('refuses the bet and moves nothing on a table without this change', ...)   // drop the new columns inside the transaction, as today's old-table test does
```

Keep every existing case, with fixtures moved to the new shapes.
- [ ] **Step 2: Run and see them fail.** `node <wrapper> test/db/slots.db.test.ts`
- [ ] **Step 3: Implement** the SQL, `walletBetSql`'s `check`, the repository and the fake (the fake mirrors codes 10 and 11, three pots, meters and the daily count).
- [ ] **Step 4: Run again,** with `test/db/roulette.db.test.ts`. Expected: PASS, roulette unchanged.
- [ ] **Step 5: Commit** `feat: the slots money step keeps meters, three jackpots and a daily limit`.

---

### Task 5: The API plays a cascade round

**Files:**
- Modify: `apps/api/src/slots/slots.service.ts`, `slots.controller.ts`, `apps/api/test/slots.http.test.ts`

**Interfaces.**
- Consumes: `slotPlayRound`, `slotReplayRound`, `slotJackpotAdds`, Task 4's repository.
- Produces: `POST /api/slots/spin` answers `SlotSpinResult` (Task 1); `GET /api/slots` gives `jackpots`, `meters` and `daily`; `PUT /api/gm/slots/jackpots` (body `slotPotsSettingsSchema`) and `PUT /api/gm/slots/daily` (body `slotDailySchema`) replace `PUT /api/gm/slots/jackpot`. The GM routes keep the GM guard, the 30-a-minute throttle and an audit row each (`JACKPOTS mini on 1 major on 10 giga on 50`, `DAILY 1500`).

The spin: settings; machine, floor, machine switch and stake checks as today; read the meter for (account, machine, stake); `slotPlayRound(machine, meter, () => this.reels())`; payout `lineStakes x stake / 20`; `multiple = min(32767, floor(payout / stake))`; if the payout is 0 and any pot is on: `adds = slotJackpotAdds` with switched-off pots set to 0, and three rolls drawn in the order Mini, Major, Giga; the bet with `daily = settings.daily`; refusals: code 10 is `403` with `You have played today's {limit} rounds. The slots open again for you tomorrow.` (limit grouped with a comma); code 11 is `409` with `Your meter changed. Press Spin again.`; the others as today. The answered spin carries `meterFree` and `pots`; `meter` is the meter after the round.

- [ ] **Step 1: Write the failing tests.** Reuse today's `draws(...)` helper (exact draw counts) and a `stopsWhere` that now scans with `slotChain`:

```ts
it('a round with a chain pays the chain with its step multipliers', ...)  // payout === slotReplayRound(...).lineStakes x stake / 20; 5 draws
it('a round with free spins and a retrigger draws them in play order', ...)
it('a round that fills the meter plays 8 meter free spins after the paid spin', ...) // meter planted at size - 1; draws 5 + 40
it('a lost round with all pots on draws three jackpot numbers last', ...)  // 8 draws
it('a lost round with only the Giga on still draws three numbers and adds only to the Giga', ...)
it('refuses round 1,501 with 403 and the daily message, after drawing only the round', ...) // fake code 10: nothing moved
it('refuses a changed meter with 409 and the meter message', ...)
it('refuses a stake above 5 Gold before anything is drawn', ...)          // 400
it('answers the state with three pots, the meters and the day', ...)
it('the GM saves three pots and the daily limit, and refuses caps out of order', ...)
it('the page still opens when the pots cannot be read', ...)               // jackpots: []
```

Update every existing case to the new shapes; keep them all.
- [ ] **Step 2: Run and see them fail.** `npx vitest run test/slots.http.test.ts --maxWorkers=2` in `apps/api`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again,** then the whole API unit suite once, `npx tsc --noEmit -p apps/api`, and `npx oxlint apps/api/src apps/api/test`. Expected: all PASS and clean.
- [ ] **Step 5: Commit** `feat: the slots API plays cascade rounds with the meter, three jackpots and a daily limit`.

---

### Task 6: A round as steps to show

**Files:**
- Modify: `apps/web/src/lib/slot-round.ts`, `slot-round.test.ts`, `apps/web/src/test/slot-fixture.ts`

**Interfaces.**

```ts
export type ShownStep = SlotStep & {
  /** The multiplier this step paid at: the paid spin's step multiplier, or the free round's climbing one. */
  times: number;
  /** Silver this step won (multiple x times x stake / 20). */
  won: number;
  /** The round's running total after this step. */
  total: number;
};
export type RoundSpin = {
  stops: SlotStops;
  /** 'paid', or the free spin's index, or the meter free spin's index. */
  kind: { paid: true } | { free: number } | { meter: number };
  steps: ShownStep[];
  scatters: number;
  /** Free spins this spin added: the paid spin's award, or a retrigger's (what fit under 50). */
  added: number;
  won: number;
  total: number;
};
export function roundSpins(machine: SlotMachine, spin: Pick<SlotSpinView, 'stops' | 'free' | 'meterFree' | 'stake'>, meterBefore: number): RoundSpin[];
export function wonTiles(step: SlotStep): [number, number][];   // = step.burst
// winTier unchanged
export function roundLine(spin: SlotSpinView, spins: RoundSpin[]): string;
export function roundListLine(machine: SlotMachine, spin: SlotSpinView): string;
export function bigWinLine(machine: SlotMachine, spin: SlotSpinView): string;
```

`roundLine`, verbatim, first match wins:

| The round | The line |
|---|---|
| won one or more pots | `{Mini / Major / Giga, joined with " and "} jackpot. You won {pots sum} on a stake of {stake}.` (`Mini and Giga jackpots.` for two) |
| paid nothing | `No win this time. You staked {stake}.` |
| had free or meter free spins | `{n} free spins won you {free total or "nothing"}. You won {payout} in all on a stake of {stake}.` (n counts both kinds) |
| the paid chain ran 2 or more winning steps | `A chain of {steps}. You won {payout} on a stake of {stake}.` |
| otherwise | `{k} lines won. You won {payout} on a stake of {stake}.` (`1 line won.`) |

`roundListLine`: `{machine}: staked {stake}, won {nothing | amount | the jackpot, amount}` plus ` with {n} free spins` when there were any. `bigWinLine`: `{character} won {amount} on {machine} on a stake of {stake}` plus `, with {n} free spins`; a jackpot round: `{character} won the {pot names} jackpot, {amount}`.

- [ ] **Step 1: Write the failing tests** on fixtures with known chains: a two-step chain's `times` 1 and 2 and `won`; a free round's `times` 2, 3, 4 carried across spins and capped at 10; a retrigger's `added`; meter free spins after the paid spin; the last `total` equals `slotReplayRound(...).lineStakes x stake / 20`; each row of the table above exactly; the list and big-win lines.
- [ ] **Step 2: Run and see them fail.** `npx vitest run src/lib/slot-round.test.ts --maxWorkers=2` in `apps/web`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: a cascade round as spins and steps to show, with its lines in words`.

---

### Task 7: The reels show a cascade step

**Files:**
- Modify: `apps/web/src/components/slots/Reels.tsx`, `Reels.test.tsx`

**Interfaces.** `Reels` gains:

```ts
/** When set, the window shows this grid instead of the strips: a cascade step. A new key starts its transition. */
step?: { grid: SlotGrid; drop: number[][]; burst: [number, number][]; key: string } | null;
/** Called once per step key when its tiles have landed. Never after unmount. */
onStepLanded?: () => void;
/** Seconds for a burst and for a fall; the page halves them for quick spin. */
stepTimes?: { burst: number; fall: number };
```

How a step is drawn: the previous step's `burst` tiles fade and scale out over `burst` seconds; then each tile of the new grid starts `drop[reel][row]` rows above its place and falls to it over `fall` seconds (ease-in, a small bounce at the end). With `animate` false or reduce motion, the grid is drawn at once and `onStepLanded` is called at once. Lit tiles and lines still come from the page's `lit` and children. Default times: burst 0.3 s, fall 0.35 s.

- [ ] **Step 1: Write the failing tests:** a step grid replaces the strips and shows each tile's symbol; tiles start offset by `drop` rows and land at 0; `onStepLanded` once per key after `burst + fall`, never twice for a re-render with the same key, never after unmount; reduce motion lands at once; going back to `step: null` with a new spin draws the strips again.
- [ ] **Step 2: Run and see them fail.** `npx vitest run src/components/slots --maxWorkers=2`
- [ ] **Step 3: Implement** with CSS transforms on the tiles, driven by the same animation-frame approach as the strips (no timeouts), so a test's fake clock moves both.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: the slots reels burst winning tiles and drop new ones in`.

---

### Task 8: Sounds for cascades, the meter and three jackpots

**Files:**
- Modify: `apps/web/src/lib/slot-sounds.ts`, `slot-sounds.test.ts`

New `SlotSound` names, each its own small recipe: `burst` (a crisp crack; `step` raises it for later chain steps), `retrigger` (a short rising flourish), `meterPoint` (a soft tick, higher as the meter fills: `step` is the points), `meterFull` (a bright chord), `jackpotMini` (a short bell run), `jackpotMajor` (longer, fuller). `jackpot` stays for the Giga. The test "has a recipe for every sound" covers the new names; add: `burst` with a high `step` starts finite, positive frequencies.

- [ ] **Steps:** failing tests, run, implement, run (`npx vitest run src/lib/slot-sounds.test.ts --maxWorkers=2`), commit `feat: slots sounds for bursts, retriggers, the meter and three jackpots`.

---

### Task 9: The player page plays cascades

**Files:**
- Modify: `apps/web/src/lib/use-slot-round.ts`, `apps/web/src/routes/_authed/slots.tsx`, `apps/web/src/routes/slots.test.tsx`, `apps/web/src/components/slots/WinShow.tsx`, `apps/web/src/lib/slots.ts`
- Create: `apps/web/src/components/slots/JackpotMeters.tsx`, `MeterBar.tsx`
- Delete: `apps/web/src/components/slots/JackpotBanner.tsx` (and its uses)

**The show, per spin of `roundSpins`:**
1. The reels turn and stop as today (paid spin: suspense when two scatters show on stopped reels; free and meter spins: none).
2. **Step 1:** its lines lit and drawn, the Win figure adds the step's `won`, the multiplier badge shows `x{times}` on the cabinet, sounds as today (`lineWin` only once the running total has reached the stake).
3. **Each later step:** `burst` sound, the reels' step transition (Task 7), then that step's lines as in 2. A step that wins nothing ends the spin.
4. **After the paid spin's chain:** meter points arrive (`meterPoint` per point; `MeterBar` moves); if it filled: banner `Meter full: 8 free spins`, `meterFull`.
5. **Free spins** (scatter or meter): banner `{n} free spins. The multiplier climbs.` with `freeStart`; each spin under `Free spin {i} of {n}` with the climbing badge; a retrigger: banner `+{added} free spins`, `retrigger`, and `n` grows; the closing banner as today.
6. **The end:** tiers as today; a pot won: its sound (`jackpotMini`, `jackpotMajor`, or `jackpot` for the Giga; the biggest won plays) and that pot's meter celebrates.
7. Only now `reveal()`: wallet, pots, meter, lists and the result line change; the 400 ms rest starts.

Step timing: burst 0.3 s, fall 0.35 s, lines 0.6 s each up to 2.4 s; quick spin halves all. A press during a chain ends the spin's chain at once on its last step (steps not yet shown are skipped, their wins added); during other phases as today. Skip to the total and reduce motion as today.

**The page around it:**
- `JackpotMeters` replaces the banner: three bars, `Mini`, `Major`, `Giga`, each with the pot, `must drop before {cap}` and the last winner; on a phone one row of three compact bars. A pot switched off reads `Paused`. Empty `jackpots` shows nothing.
- `MeterBar` under the stakes: `Meter {points} / {size}` for the chosen machine and stake.
- `{left} rounds left today` under Spin when 200 or fewer are left; at 0 Spin is off and the note is `You have played today's {limit} rounds. The slots open again for you tomorrow.`
- Refusal 409 (meter changed): its message, the state reloads, no sound but `refused`.
- On a 360 x 560 screen Spin is still fully on the first screen.

- [ ] **Step 1: Write the failing tests** (keep every existing case that applies, moved to the new shapes; results through `stopsWhere` and the shared rules only):

```ts
it('shows a chain step by step, each step's lines and win only once that step has landed', ...)
it('shows the step multiplier on the cabinet, x1 then x2', ...)
it('a press during a chain jumps to the end of that spin's chain with the right total', ...)
it('adds meter points only after the paid spin's chain has ended', ...)
it('plays meter free spins after a full meter, with their banner', ...)
it('carries the climbing multiplier across free spins and shows a retrigger', ...)
it('holds the wallet, the pots and the meter until the whole round has been shown', ...)
it('shows three jackpots and celebrates only the pot that dropped', ...)
it('shows rounds left near the limit and switches Spin off at 0', ...)
it('a changed meter refusal reloads the state and the next press plays', ...)
it('sounds a burst for each later step, and never before that step', ...)
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/routes/slots.test.tsx --maxWorkers=2`
- [ ] **Step 3: Implement.** Keep `use-slot-round.ts`'s one-clock design and its `finish` as the only door to `onDone`.
- [ ] **Step 4: Run again,** with `src/lib`, `src/components/slots` and `src/routes/nav.test.tsx`; `npx tsc -b --noEmit` may only fail in the GM page and its test; eslint clean on the touched files.
- [ ] **Step 5: Commit** `feat: the slots page plays cascades, the meter and three jackpots`.

---

### Task 10: What it pays

**Files:**
- Modify: `apps/web/src/components/slots/PayTable.tsx`, `PayTable.test.tsx`

Adds to today's table, in this order after the wild and the scatter:
1. `Cascades: winning symbols burst and new ones fall in from above. Each win in a row pays more: x1, x2, x3, x4, then x5.`
2. `Free spins: 3, 4 or 5 scatters give 8, 12 or 20. The multiplier starts at x2 and climbs with every win, up to x10. 3 scatters during free spins add 5 more, up to 50.`
3. `Meter: every scatter that does not win free spins fills it. At {size} it pays 8 free spins. One meter for each machine and stake.`
4. `Jackpots: every lost round feeds the Mini, the Major and the Giga. Each must drop before its cap.`
5. Figures: `This machine pays back {total, one decimal}% of what goes into it over time, counting the meter and the jackpots. A short session can pay back less, and the meter only pays when it fills.` / `One round in {round(1 / paysRate)} pays something.` / `Free spins come about once in {round(1 / freeRate)} rounds; the meter fills about once every {round(1 / meterRate)}.` / `The most one paid spin can win at these stakes is {largest}. A round with free spins can win more.` / jackpot sentence only when a pot is on: `A lost round adds {share, one decimal}% of its stake to the jackpots.`

`{total}` is `R + L x num / den`, so it reads `105.0` for every machine. Tests: each sentence exact, from hand-set counts on a fixture machine.

- [ ] **Steps:** failing tests, run, implement, run (`npx vitest run src/components/slots --maxWorkers=2`), commit `feat: the slots pay table explains cascades, the meter and three jackpots`.

---

### Task 11: The GM page, the rollout script, the whole suite and one browser check

**Files:**
- Modify: `apps/web/src/routes/_authed/gm/slots.tsx`, `apps/web/src/routes/gm-slots.test.tsx`
- Modify: `docs/superpowers/specs/2026-11-15-slots-modern-design.md` and `2026-11-15-slots-jackpot-design.md` (one line under each title: `Changed on 2026-11-15 by 2026-11-15-slots-cascades-design.md.`)
- Create, outside the repo: `C:\Users\stath\Documents\4Story\4s\db_changes\2026-11-15-portal-slots-cascades\apply.sql` and `undo.sql`; copy the folder into the Server repo's `db_changes\` as earlier scripts were (do not commit or push there)
- Modify, outside the repo: `C:\Users\stath\Documents\4Story\4s\GAME_CHANGES_LEDGER.md`

**GM page:** the Jackpots section shows three pots (switch, cap in whole Gold with "can drop from {cap / 10}, must drop before {cap}", the running pot, added, paid, drops, last 10 drops) and saves all three at once, showing `The caps must rise: Mini below Major below Giga` when they do not; a Daily limit field (`Rounds per account per day`, 100 to 10,000); next to each machine's stakes, `At 105%, a player spinning nonstop at {top stake} gains about {1,200 x top stake x 0.05} an hour.`; the stake form refuses above 5 Gold with today's message.

- [ ] **Step 1:** failing GM tests (three pots saved, out-of-order caps refused with nothing sent, the daily limit saved, the cost sentence exact, stakes above 5 Gold refused), implement, run.
- [ ] **Step 2: `apply.sql` and `undo.sql`** against `TGAME_GSP`, from the three table scripts, safe to run twice; the top says the slots, jackpot and five-reel scripts go first. Undo deletes pot rows 2 and 3 (saying their money is lost unless they drop first), drops the meter table and the new columns and index, narrows `szFree` back only if every row fits (otherwise leaves it and says why), and restores the `bID = 1` check. **Do not run either.**
- [ ] **Step 3: The ledger entry,** "written, not applied": what changes, the economy (105% total, about 5 Gold created per 100 staked, the 5 Gold stake cap, the daily limit and what it caps), no game server restart, the SQL before the API, the undo.
- [ ] **Step 4: The whole suite:** `npm run build -w packages/shared`; `npm run lint`; vitest in `packages/shared`, `apps/api`, `apps/web`; the slots and roulette DB files through the wrapper. Quote each command's real last lines.
- [ ] **Step 5: Commit** `feat: the GM slots page runs three jackpots and the daily limit` and `docs: the earlier slots designs point at the cascades design`.
- [ ] **Step 6: One watched browser check,** exactly as the five-reel work did it: one headless Edge over its debugging port, one tiny static server with canned answers serving one `vite build`, CPU and memory watched, both stopped and proven gone. Check only: at 360 x 560 the three jackpot meters, the meter bar and Spin fit with Spin fully on the first screen; at 768 x 900 and 1280 x 800 no sideways scroll and the layout holds; a cascade step's fallen tiles land exactly on their cells (tile boxes against the window's grid, 2 px tolerance); the free spins and meter banners sit inside the window. Fix layout failures with the smallest change, rerun the affected tests, commit as `fix:`.
- [ ] **Step 7: Tell the owner** what only they can judge: every new sound, the cascade's feel and speed, the three meters on a phone, and the figures each machine landed on.
