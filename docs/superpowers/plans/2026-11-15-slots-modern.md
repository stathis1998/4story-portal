# Modern Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three slot machines become five-reel machines with 20 win lines, a wild, free spins, a bigger cabinet, win celebrations and sound.

**Architecture:** The rules (lines, wilds, scatters, a round's payout) are pure functions in `packages/shared`; each machine carries the counts of all 33,554,432 windows as stored numbers that a test recounts from the strips. The API draws a whole round (the paid spin and its free spins) and pays it in the existing one-transaction money step, recording one row. The page turns the answered round into a list of spins and plays them one after another, holding the wallet and the pot still until the end; sound is a small Web Audio engine the page calls as things happen on screen.

**Tech Stack:** NestJS + mssql + zod (API), React 19 + TanStack Router/Query + Tailwind (web), Web Audio, vitest, SQL Server.

**Spec:** `docs/superpowers/specs/2026-11-15-slots-modern-design.md`. Read it first, then the two it changes: `docs/superpowers/specs/2026-11-14-slots-design.md` and `docs/superpowers/specs/2026-11-15-slots-jackpot-design.md`. The code to read: `packages/shared/src/slots.ts`, `apps/api/src/slots/`, `apps/api/src/games/wallet-bet.ts`, `apps/api/test/fakes.ts` (`FakeSlotsRepository`), `apps/api/test/slots.http.test.ts`, `apps/api/test/db/slots.db.test.ts`, `apps/web/src/routes/_authed/slots.tsx`, `apps/web/src/routes/_authed/gm/slots.tsx`, `apps/web/src/components/slots/`, `apps/web/src/lib/slots.ts`, `apps/web/src/lib/reel-blur.ts`, `apps/web/src/lib/wallet-game.ts`, `apps/web/src/routes/slots.test.tsx`, `apps/web/src/routes/gm-slots.test.tsx`. Copy their patterns unless this plan says otherwise.

## Global Constraints

- **Never edit or print `.env`.** It names the live databases. Run DB tests with `DB_GLOBAL_NAME=TGLOBAL_GSP_TEST DB_GAME_NAME=TGAME_GSP_TEST` set in the shell. A worktree has no `.env`: load the main one into the shell with a small dotenv script (plain `. .env` fails, a value has an unquoted space), then set those two names.
- **Never run SQL against `TGAME_GSP` or `TGLOBAL_GSP`.** Only the `_TEST` copies, and DB tests roll everything back. Applying the script anywhere else waits for the owner.
- **No dev servers, no `nest build`, no browsers** except the single watched browser check in Task 11. Vitest only, affected files only, with `--maxWorkers=2`.
- **Run every test command from a folder spelled with a capital `C:`** (`cd "C:/Users/..."`). From a lowercase `c:` folder vitest fails every file with "failed to find the current suite".
- `@4story-portal/shared` is consumed from `dist`: after changing it run `npm run build -w packages/shared` before API or web tests. Tasks 1 to 3 change only `packages/shared`; the API's and the web's tests go red when `dist` is rebuilt at the end of Task 3 and come back in Tasks 4 and 5 (API) and 6 to 11 (web). Each task runs only the files it names.
- Money on the wire is whole **Silver** (1 Gold = 1000 Silver). In the database money is **Bronze** in `BIGINT` (1 Silver = 1000 Bronze); the mssql driver returns `BIGINT` as a string.
- **A stake is a multiple of 20 Silver, from 20 Silver to 100 Gold.** The line stake is `stake / 20`. Every prize is a whole multiple of the line stake, so every win is whole Silver.
- **Free spins:** 3, 4 or 5 scatters showing give 8, 12 or 20, every win in them is doubled, and a free spin never gives more free spins.
- **A round** is the paid spin plus its free spins. **A lost round** pays nothing in total; only a lost round feeds the pot or wins it. Nothing is ever rounded up.
- Returns stay between 95% and 96.5%, free spins counted. Nothing counts 33 million windows at run time: only the count test does.
- A win smaller than the stake is never celebrated. Nothing sounds before the player's first press. Nothing on screen or in the sound gives a result away before its reels stop.
- The game calls the coins Gold, Silver and Bronze in everything a person reads. Code and columns keep `copper` / `dwCooper`.
- UI copy is plain ASCII punctuation, sentence case, no exclamation marks. Exact strings in this plan are verbatim.
- Roulette's tests pass unchanged. The jackpot's drop rule (`slotJackpotDrops`, the pot step's SQL) is not touched.
- Commits: `feat:` / `fix:` / `test:` / `docs:` prefix, ending with the `Co-Authored-By:` line the committing session is given. Work on branch `feat/slots-modern`, never on `main`.

## Review Focus

1. **The new API runs before the new columns are in the database:** the slots page still opens; a spin is refused with "Slots are not available right now" and takes nothing. (Tasks 4 and 5)
2. **A row the lists cannot show** (an old three-reel row, stops out of range, free spins text that does not parse): it is left out of every list and still counted in the GM totals; neither page breaks. (Tasks 4 and 5)
3. **Stakes from before the change:** a GM row like `10,25,50` falls back to the starting stakes; a stake remembered in the player's browser that is no longer offered (25) becomes the machine's lowest with no "stakes changed" note. (Tasks 1 and 10)
4. **The player leaves mid-round** (another page, another tab, the component unmounts during free spins): timers stop, the turning-reels sound stops, no state is set after unmount, and coming back shows the final wallet. (Tasks 7 and 10)
5. **No sound available:** no `AudioContext` in the browser, one that stays suspended, or storage blocked. The page plays silently, nothing throws, and the sound button still switches. (Task 7)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/slots.ts` | Types, limits, stakes, schemas, API views, the jackpot's drop rule (as today, with five stops and rounds) |
| `packages/shared/src/slot-rules.ts` | New: the 20 lines, the window, what a spin wins, what a round pays, free spins as text |
| `packages/shared/src/slot-figures.ts` | New: the published figures worked out from a machine's stored counts, and the jackpot share |
| `packages/shared/src/slot-count.ts` | New: counts every window of a machine. Used by tests and the strip search only; not exported from `index.ts` |
| `packages/shared/src/slot-machines.ts` | New: the three machines (symbols, strips, prizes, stored counts, rest) |
| `apps/api/sql/TPORTALSLOTSPIN.sql` | Gains stops 4 and 5, the rules number, the free spins text |
| `apps/api/src/slots/slots.repository.ts`, `slots.service.ts`, `slots.controller.ts` | The round in the bet and in the lists; drawing and adding up a round; the throttle |
| `apps/web/src/lib/slots.ts` | Five reels' motion, stop times, suspense |
| `apps/web/src/lib/slot-sounds.ts` | New: the sound engine |
| `apps/web/src/lib/slot-round.ts` | New: a round as a list of spins to show, the win tiers, the result lines |
| `apps/web/src/components/slots/Reels.tsx` | Five reels, lit tiles, stop now, a callback per reel |
| `apps/web/src/components/slots/WinLines.tsx` | New: win lines drawn over the window, and the small map of all 20 |
| `apps/web/src/components/slots/WinShow.tsx` | New: the big win, huge win and free spins banners |
| `apps/web/src/components/slots/PayTable.tsx` | Prizes for 3, 4 and 5, the wild, the scatter, the lines, the figures |
| `apps/web/src/routes/_authed/slots.tsx`, `_authed/gm/slots.tsx` | The player page's round; the GM page's stakes rule and lists |

---

### Task 1: The rules of a spin and a round

**Files:**
- Create: `packages/shared/src/slot-rules.ts`, `packages/shared/src/slot-rules.test.ts`
- Modify: `packages/shared/src/slots.ts`, `packages/shared/src/slots.test.ts`, `packages/shared/src/index.ts`
- Commit also: the spec and this plan

**Interfaces. Produces:**

In `slots.ts` (changed or new; the jackpot's cap constants, `slotJackpotDrops` and the settings schemas stay):

```ts
export const SLOT_REELS = 5;
export const SLOT_ROWS = 3;
export const SLOT_REEL_STOPS = 32;
export const SLOT_LINE_COUNT = 20;
export const SLOT_STAKE_STEP = 20;
export const SLOT_MIN_STAKE = 20;
export const SLOT_MAX_STAKE = 100_000;
/** Symbol indexes: 0..7 pay (0 is the lucky one, 7 the top prize), 8 is the wild, 9 the scatter. Reel letters A..J. */
export const SLOT_PAYING = 8;
export const SLOT_WILD = 8;
export const SLOT_SCATTER = 9;
export const SLOT_LETTERS = 'ABCDEFGHIJ';
/** Free spins for 3, 4 and 5 scatters showing. */
export const SLOT_FREE_SPINS: Readonly<Record<number, number>> = { 3: 8, 4: 12, 5: 20 };
export const SLOT_FREE_MULTIPLIER = 2;
export type SlotStops = [number, number, number, number, number];
/** All windows of the machine, counted (see slot-count.ts). */
export type SlotCounts = {
  /** The sum, over every window and all 20 lines, of the line's prize in line stakes. */
  linePaid: number;
  /** Windows where no line pays. */
  blank: number;
  /** Windows showing exactly 3, 4 and 5 scatters. */
  scatters: [number, number, number];
  /** Of those, the windows where no line pays. */
  blankScatters: [number, number, number];
  /** The most the 20 lines of one window pay together, in line stakes. */
  best: number;
};
export type SlotMachine = {
  key: SlotMachineKey;
  name: string;
  /** Ten, in the index order above. */
  symbols: readonly SlotSymbol[];
  /** Five loops of 32 letters, read downward. */
  reels: readonly [string, string, string, string, string];
  /** For each of the 8 paying symbols: the prize for 3, 4 and 5 alike, in line stakes. */
  pays: readonly (readonly [number, number, number])[];
  /** Two lucky symbols from the left, in line stakes. */
  twoLucky: number;
  stakes: SlotStakes;
  counts: SlotCounts;
  /** Where the machine rests before its first spin. */
  rest: SlotStops;
};
export type SlotSpinView = {
  id: number; at: string; character: string; machine: SlotMachineKey;
  stops: SlotStops;
  /** Each free spin's stops in the order played; empty when there were none. */
  free: SlotStops[];
  stake: number;
  /** The whole round, whole Silver. */
  payout: number;
  jackpot: number;
};
```

`parseSlotStakes`, `slotMachineSettingsSchema` and `slotSpinRequestSchema` accept only multiples of 20 between `SLOT_MIN_STAKE` and `SLOT_MAX_STAKE`. The stakes schema's message becomes `Enter three different stakes in multiples of 20 Silver, lowest first`.

Removed from `slots.ts` in this task: `SLOT_MACHINES` and `slotMachine` (they move in Task 3), `slotWindow`, `slotPrize`, `SlotPrize`, `slotLine`, `slotRest`, `slotOdds`, `slotReturn`, `slotLargestWin`, `slotJackpotShare`, `slotJackpotAdd` and their tests. `index.ts` exports `slot-rules.js` (and, as they appear, `slot-figures.js` and `slot-machines.js`; never `slot-count.js`).

In `slot-rules.ts`:

```ts
/** The row (0 top, 1 middle, 2 bottom) each line takes on reels 1 to 5. */
export const SLOT_LINES: readonly (readonly [number, number, number, number, number])[];
/**
 * [reel][row] symbol indexes. Row 1 is the stop; row 0 is the strip's letter before it, row 2 the one after.
 * It wraps by each strip's own length, so a test can use short strips; the real machines are all 32.
 */
export function slotWindow(machine: SlotMachine, stops: SlotStops): number[][];
/** `line` indexes SLOT_LINES. `multiple` is in line stakes and never doubled here. */
export type SlotLineWin = { line: number; symbol: number; count: 2 | 3 | 4 | 5; multiple: number };
export type SlotSpinOutcome = {
  /** Lowest line first. */
  lines: SlotLineWin[];
  /** The lines added together, in line stakes. */
  multiple: number;
  scatters: number;
  /** 0, 8, 12 or 20. What a PAID spin showing this window wins. */
  freeSpins: number;
};
export function slotSpin(machine: SlotMachine, stops: SlotStops): SlotSpinOutcome;
export type SlotRound = { stops: SlotStops; free: SlotStops[] };
/** What the round pays in whole Silver at `stake`: (paid spin + 2 x each free spin) x stake / 20. */
export function slotRoundPayout(machine: SlotMachine, round: SlotRound, stake: number): number;
/** '3,17,0,22,9;1,2,3,4,5', '' for none. */
export function slotFreeText(free: SlotStops[]): string;
/** Null when the text is not that: a wrong count of stops, a stop outside 0..31, more than 20 spins, anything else. */
export function parseSlotFree(text: string): SlotStops[] | null;
```

`SLOT_LINES`, in order (line 1 is index 0):

```
1,1,1,1,1  0,0,0,0,0  2,2,2,2,2  0,1,2,1,0  2,1,0,1,2
1,0,0,0,1  1,2,2,2,1  0,0,1,2,2  2,2,1,0,0  1,2,1,0,1
1,0,1,2,1  0,1,1,1,0  2,1,1,1,2  0,1,0,1,0  2,1,2,1,2
1,1,0,1,1  1,1,2,1,1  0,0,2,0,0  2,2,0,2,2  0,2,2,2,0
```

How a line is read: take the symbol on reel 1 at the line's row. A scatter there pays nothing. Otherwise count reel 1 and every following reel whose symbol on the line is the same or the wild, stopping at the first that is neither. Three, four or five pay `pays[symbol][count - 3]`; two pay `twoLucky` when the symbol is 0. The wild never appears on reel 1 in a real machine, and a wild on reel 1 pays nothing.

- [ ] **Step 1: Write the failing tests** in `slot-rules.test.ts`. They use a fixture, not the real machines:

```ts
const TOP = 'GHGHG', BOTTOM = 'HGHGH'; // filler rows that can never start or continue a win here
/**
 * A machine whose window at stops [4k+1 x5] is windows[k] (three rows of five letters). pays[i] = [5, 20, 100]
 * times (i + 1); twoLucky = 2. Unused strip positions are 'G'.
 */
function showing(...windows: [string, string, string][]): SlotMachine
const at = (k: number): SlotStops => [4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1, 4 * k + 1];

it('has 20 different lines of rows 0 to 2', ...) // length 20, Set of joined rows has size 20, every row is 0, 1 or 2

// With a wild in the middle of reel 2, a filler symbol on reel 1 could win through it. A scatter there cannot.
const WILD_TOP = 'JHGHG', WILD_BOTTOM = 'JGHGH';

it.each([
  ['three alike from the left', [TOP, 'BBBCD', BOTTOM], [{ line: 0, symbol: 1, count: 3, multiple: 10 }]],
  ['four alike', [TOP, 'BBBBD', BOTTOM], [{ line: 0, symbol: 1, count: 4, multiple: 40 }]],
  ['five alike', [TOP, 'BBBBB', BOTTOM], [{ line: 0, symbol: 1, count: 5, multiple: 200 }]],
  ['a wild completes a line', [WILD_TOP, 'BIBCD', WILD_BOTTOM], [{ line: 0, symbol: 1, count: 3, multiple: 10 }]],
  ['two wilds complete a line', [WILD_TOP, 'BIICD', WILD_BOTTOM], [{ line: 0, symbol: 1, count: 3, multiple: 10 }]],
  ['two alike pay nothing', [TOP, 'BBCDE', BOTTOM], []],
  ['a line must start on reel 1', [TOP, 'CBBBB', BOTTOM], []],
  ['a scatter on reel 1 pays nothing', [TOP, 'JBBBB', BOTTOM], []],
  ['a wild on reel 1 pays nothing', [TOP, 'IBBBB', BOTTOM], []],
])('%s', (_name, rows, lines) => {
  const out = slotSpin(showing(rows as [string, string, string]), at(0));
  expect(out.lines).toEqual(lines);
  expect(out.multiple).toBe(lines.reduce((sum, l) => sum + l.multiple, 0));
});

it('pays two lucky symbols on every line through them', () => {
  // Lines 1, 16 and 17 all run through the middle of reels 1 and 2.
  const out = slotSpin(showing([TOP, 'AACDE', BOTTOM]), at(0));
  expect(out.lines.map((l) => [l.line, l.count, l.multiple])).toEqual([[0, 2, 2], [15, 2, 2], [16, 2, 2]]);
  expect(out.multiple).toBe(6);
});

it('counts a lucky symbol and a wild as two', () =>
  expect(slotSpin(showing([WILD_TOP, 'AICDE', WILD_BOTTOM]), at(0)).multiple).toBe(6));

it('adds up two winning lines', () => {
  const out = slotSpin(showing(['CCCGH', 'BBBDE', 'HGHGH']), at(0));
  expect(out.lines).toEqual([
    { line: 0, symbol: 1, count: 3, multiple: 10 },
    { line: 1, symbol: 2, count: 3, multiple: 15 },
  ]);
  expect(out.multiple).toBe(25);
});

it.each([
  [['JHGHG', 'BCJDE', 'HGHGJ'], 3, 8],
  [[TOP, 'JJJJG', BOTTOM], 4, 12],
  [[TOP, 'JJJJJ', BOTTOM], 5, 20],
  [['GHCHG', 'JIJBB', 'HGDGH'], 2, 0], // a wild is not a scatter
])('scatters count anywhere in the window: %j', (rows, scatters, freeSpins) => {
  const out = slotSpin(showing(rows as [string, string, string]), at(0));
  expect([out.scatters, out.freeSpins, out.multiple]).toEqual([scatters, freeSpins, 0]);
});

it('shows the real neighbours of a stop and wraps the loop', ...) // stop 0: row 0 is letter 31, row 2 is letter 1

it('pays a round: the paid spin once and each free spin doubled, at a twentieth of the stake', () => {
  const m = showing([TOP, 'BBBCD', BOTTOM], [TOP, 'BBBBD', BOTTOM], [TOP, 'CDEFG', BOTTOM]);
  expect(slotRoundPayout(m, { stops: at(0), free: [] }, 40)).toBe(20);            // 10 x 2
  expect(slotRoundPayout(m, { stops: at(0), free: [at(1), at(2)] }, 40)).toBe(180); // (10 + 2 x 40) x 2
  expect(slotRoundPayout(m, { stops: at(2), free: [] }, 100_000)).toBe(0);
});

it('writes free spins as text and reads them back', ...)
// slotFreeText([]) === ''; round trip of two spins is '3,17,0,22,9;1,2,3,4,5'; parseSlotFree('') equals [];
// null for '1,2,3', '1,2,3,4,32', '1,2,3,4,x', '1,2,3,4,5;', and 21 spins
```

If one of the hand-worked expectations fails, check the window against the `SLOT_LINES` table above before touching the expectation.

In `slots.test.ts`, replace the stake tests:

```ts
it.each([['20,40,60', [20, 40, 60]], ['40, 100, 100000', [40, 100, 100000]]])('reads %s', ...)
it.each(['10,25,50', '0,20,40', '20,40', '40,20,60', '20,20,40', '20,40,100020', '20,40,x', '20.0,40,60'])('refuses %s', (text) =>
  expect(parseSlotStakes(text)).toBeNull());
// slotSpinRequestSchema: stake 40 passes; 25, 0, 10 and 100020 fail
// slotMachineSettingsSchema: [20, 40, 60] passes; [10, 25, 50] fails with the message above
```

- [ ] **Step 2: Run them and see them fail.** `cd "C:/.../packages/shared" && npx vitest run src/slot-rules.test.ts src/slots.test.ts --maxWorkers=2`. Expected: FAIL, `slot-rules.js` not found.
- [ ] **Step 3: Implement** the exports above. Delete the three-reel rules and their tests from `slots.ts` / `slots.test.ts`; keep every jackpot drop and settings test.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: slots rules for five reels, 20 lines, wilds and free spins` (with the spec and this plan).

---

### Task 2: Counting every window, and the figures that follow

**Files:**
- Create: `packages/shared/src/slot-count.ts`, `packages/shared/src/slot-figures.ts`, `packages/shared/src/slot-figures.test.ts`

**Interfaces.**
- Consumes: `SlotMachine`, `SlotCounts`, `slotSpin`, `SLOT_FREE_SPINS`, `SLOT_FREE_MULTIPLIER` from Task 1.
- Produces:

```ts
// slot-count.ts
/** Counts every window (32^5 for a real machine; any strip lengths work). Takes seconds: tests and the strip search only. */
export function countSlotMachine(machine: Pick<SlotMachine, 'reels' | 'pays' | 'twoLucky'>): SlotCounts;
/** linePaid and scatters only, without visiting every window: for the strip search. */
export function quickSlotCounts(machine: Pick<SlotMachine, 'reels' | 'pays' | 'twoLucky'>): Pick<SlotCounts, 'linePaid' | 'scatters'>;

// slot-figures.ts (all read machine.counts; none counts anything)
export const SLOT_COMBOS = 32 ** 5;
/** The share of all stakes paid back, free spins counted. */
export function slotReturn(machine: SlotMachine): number;
/** The chance a round is lost. */
export function slotLostRate(machine: SlotMachine): number;
/** The chance a paid spin wins free spins. */
export function slotFreeRate(machine: SlotMachine): number;
/** The most one paid spin can win at these stakes, in Silver: counts.best x the highest stake / 20. */
export function slotLargestWin(machine: SlotMachine, stakes: SlotStakes): number;
/** The share of a lost stake that goes to the pot, in billionths: { num, den: 1_000_000_000 }. */
export function slotJackpotShare(machine: SlotMachine): { num: number; den: number };
/** What a lost round of `stake` Silver adds to the pot, in whole Bronze, rounded down. */
export function slotJackpotAdd(machine: SlotMachine, stake: number): number;
```

The sums, with `C = SLOT_COMBOS`, `N = [8, 12, 20]`, `s = counts.scatters`, `b = counts.blankScatters`:

```
return   R = (linePaid / (20 x C)) x (1 + 2 x (s0 x 8 + s1 x 12 + s2 x 20) / C)
lost     L = (blank - b0 - b1 - b2) / C + sum over k of (b[k] / C) x (blank / C) ^ N[k]
free     F = (s0 + s1 + s2) / C
share    num = max(0, floor((1 - R) / L x 1e9) - 1)      the -1 covers floating-point error, so it never rounds up
add      floor(stake x 1000 x num / 1e9), worked in BigInt (the product passes 2^53)
```

How the count is made fast enough: build once a table of the line prize for every tuple of five symbols (10^5 entries, `Uint16Array` or wider if a prize passes 65535) and each reel's three symbols per stop; the inner loop is then 20 table lookups per window. `quickSlotCounts` uses that every line sees each reel's 32 letters equally often: `linePaid = 20 x sum over tuples of prize(tuple) x the product of each reel's count of that symbol`, and a reel shows a scatter on `3 x (its scatters)` stops when its scatters are at least 3 apart.

- [ ] **Step 1: Write the failing tests** in `slot-figures.test.ts`, on a fixture machine built in the test (five 32-letter strips written out by hand with every paying symbol on every reel, `I` only on reels 2 to 4, one or two `J` per reel at least 3 apart; `pays[i] = [5, 20, 100] x (i + 1)`, `twoLucky = 2`):

```ts
it('counts a small machine exactly as slotSpin reads it, window by window', ...)
// a second fixture with five strips of 8 letters (32,768 windows, wilds and scatters on them): loop every window
// through slotSpin, add up all five fields of SlotCounts in the test, and expect countSlotMachine to equal that
const counts = countSlotMachine(fixture); // the 32-letter fixture; once, in beforeAll, timeout 120_000
it('the quick count agrees with the full count', () =>
  expect(quickSlotCounts(fixture)).toEqual({ linePaid: counts.linePaid, scatters: counts.scatters }));

const machine = { ...fixture, counts: { linePaid: 20 * 0.5 * SLOT_COMBOS, blank: SLOT_COMBOS * 0.75, scatters: [0, 0, 0], blankScatters: [0, 0, 0], best: 4000 } };
it('works out the figures from the counts', () => {
  expect(slotReturn(machine)).toBeCloseTo(0.5, 12);
  expect(slotLostRate(machine)).toBeCloseTo(0.75, 12);
  expect(slotFreeRate(machine)).toBe(0);
  expect(slotLargestWin(machine, [20, 40, 60])).toBe(12_000);
  expect(slotJackpotShare(machine)).toEqual({ num: 666_666_665, den: 1_000_000_000 });
  expect(slotJackpotAdd(machine, 60)).toBe(39_999);
  expect(slotJackpotAdd(machine, 100_000)).toBe(66_666_666);
});
it('counts free spins into the return and the lost rate', ...)
// scatters [C/100, 0, 0], blankScatters [C/200, 0, 0], linePaid 20 x 0.5 x C, blank 0.75 x C:
// return 0.5 x (1 + 2 x 8 / 100) = 0.58; lost = 0.75 - 0.005 + 0.005 x 0.75^8
it('never gives a share that pays back more than is staked', ...) // R + L x num / den <= 1 and > 1 - 3e-9, for both machines above
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/slot-figures.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run again.** Expected: PASS, the full count in well under a minute.
- [ ] **Step 5: Commit** `feat: count every slots window and work the published figures out of the counts`.

---

### Task 3: The three machines

**Files:**
- Create: `packages/shared/src/slot-machines.ts`, `packages/shared/src/slot-machines.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces.**
- Consumes: Task 1's types, Task 2's `countSlotMachine`, `quickSlotCounts` and figures.
- Produces: `export const SLOT_MACHINES: readonly SlotMachine[]` (keys `shelf`, `armoury`, `hoard`, names unchanged) and `export function slotMachine(key: string): SlotMachine | undefined`.

What each machine must be:

- **Symbols:** indexes 0 to 5 are today's six, in today's order, with today's names and sprites (see the current `slots.ts` in git). Indexes 6 and 7 are two more from the same theme, 8 a wild and 9 a scatter. Pick them from `apps/web/public/game-icons/` by looking at the images (they are 32 x 32 PNGs named by sprite ID); find the item's name by searching for the sprite ID in the item data under `apps/api/src/gm/`, and if it has none there give it a plain name for what it shows. The ten must be easy to tell apart at reel size, and the wild and the scatter must stand out from the eight.
- **Strips:** 32 letters `A` to `J`. Every paying symbol on every reel. `I` (wild) only on reels 2, 3 and 4. `J` (scatter) on every reel, and two scatters on one reel at least 3 stops apart counting round the loop, so a reel never shows two.
- **Prizes:** for each symbol three < four < five; each column rises from symbol 0 to symbol 7; `twoLucky` is at least 1 and less than symbol 0's prize for three.
- **Starting stakes:** shelf `[20, 40, 60]`, armoury `[40, 60, 100]`, hoard `[60, 100, 200]`.
- **`rest`:** stops whose window has no winning line, no scatter and no wild, with five different symbols on the middle row.
- **Targets** (the test below is the exact rule):

| | Return | A round pays (1 - lost rate) | Free spins | `counts.best` at least |
|---|---|---|---|---|
| shelf | 0.95 to 0.965 | 0.28 to 0.40 | once in 65 to 100 rounds | 4,000 (200 times the stake) |
| armoury | 0.95 to 0.965 | 0.21 to 0.29 | once in 95 to 150 | 10,000 (500 times) |
| hoard | 0.95 to 0.965 | 0.17 to 0.23 | once in 130 to 200 | 20,000 (1,000 times) |

  The simplest way to reach `best` is the top symbol's prize for five alike (4,000, 10,000 and 20,000 line stakes): five on one line is so rare it barely moves the return.

- [ ] **Step 1: Write the failing tests** in `slot-machines.test.ts`:

```ts
describe.each(SLOT_MACHINES)('$name', (machine) => {
  it('has ten symbols with different names, plurals and icons', ...)
  it('has five strips of 32 letters that follow the strip rules', ...) // the three strip rules above
  it('has prizes that rise', ...)                                      // the prize rules above
  it('stores the counts its strips really give', () =>
    expect(countSlotMachine(machine)).toEqual(machine.counts), 120_000);
  it('returns between 95% and 96.5%', ...)
  it('rests on a window that looks like nothing', ...)                 // the rest rule above, through slotSpin and slotWindow
});
it.each([
  ['shelf', 0.28, 0.40, 65, 100, 4_000],
  ['armoury', 0.21, 0.29, 95, 150, 10_000],
  ['hoard', 0.17, 0.23, 130, 200, 20_000],
])('%s pays and gives free spins as often as planned', (key, payLow, payHigh, freeLow, freeHigh, best) => { ... });
it('the Shelf pays most often and the Hoard least', ...)
it('keeps the starting stakes', ...) // the three lists above
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/slot-machines.test.ts --maxWorkers=2`
- [ ] **Step 3: Find the strips and prizes.** Write a throwaway search script in the session's scratch folder (not committed) that imports `quickSlotCounts` and `countSlotMachine` from `packages/shared/src`. Suggested shape: fix a prize table per machine, start from strips with decreasing counts of symbols 0 to 7, hill-climb by swapping or replacing single letters using `quickSlotCounts` for the return and the free spin rate, and run `countSlotMachine` on candidates to read the pay rate. Stop at the first strips inside every band. Run it with one worker; it must not hold the machine for more than a few minutes at a time.
- [ ] **Step 4: Write `slot-machines.ts`** with the found strips, prizes, the counts from `countSlotMachine`, and a `rest`. Check that `apps/web/public/game-icons/{sprite}.png` exists for all thirty symbols. Above the list keep one comment saying the strips were found by search and the test recounts them.
- [ ] **Step 5: Run the tests.** Expected: PASS. If a band cannot be met after a real attempt, do not loosen the return band; widen the other band in the test by the least that fits, and say so in the task report with the figures reached.
- [ ] **Step 6: Run the whole shared suite and build.** `npx vitest run --maxWorkers=2` then `npm run build -w packages/shared` from the repo root. Expected: PASS, build clean.
- [ ] **Step 7: Commit** `feat: three five-reel slot machines with counted returns`. In the report give, per machine: return, pay rate, free spin rate, largest win as a multiple of the stake, and the jackpot share as a percentage.

---

### Task 4: The round in the database

**Files:**
- Modify: `apps/api/sql/TPORTALSLOTSPIN.sql`, `apps/api/src/slots/slots.repository.ts`, `apps/api/test/fakes.ts`, `apps/api/test/db/slots.db.test.ts`

**Interfaces.**
- Consumes: `SlotStops`, `slotFreeText`, `parseSlotFree`, `SLOT_MACHINES`.
- Produces:

```ts
export const SLOT_RULES = 2; // the rules number written on every new row; 1 is the old three-reel rows
export type SlotSpinRow = { id; userId; character; spunAt; machine: string; stops: SlotStops; free: SlotStops[]; stake; payout; jackpot };
export type SlotBetInput = { userId; charId; machine; stops: SlotStops; free: SlotStops[]; stake; payout; multiple; add; cap; roll };
```

`multiple` is `min(32767, floor(payout / stake))`. Everything else about `SlotsRepository` keeps its shape.

The table gains, both in the `CREATE TABLE` and as `IF COL_LENGTH(...) IS NULL ALTER TABLE ... ADD` blocks for a table already there:

```sql
bStop4   TINYINT      NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bStop4 DEFAULT 0,
bStop5   TINYINT      NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bStop5 DEFAULT 0,
bRules   TINYINT      NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_bRules DEFAULT 1,   -- 1: three reels (old), 2: five reels
szFree   VARCHAR(400) NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_szFree DEFAULT ''   -- the free spins' stops, slotFreeText
```

- The bet's `INSERT` names all five stops, `bRules = 2` and `szFree`.
- `spinsOf`, `bigWins`, `latest` and `jackpotWins` read only `bRules = 2`. A row whose `szFree` does not parse is left out by the repository (the service already leaves out a row whose stops are out of range).
- `totals` and `jackpotTotals` count every row, old rules included.
- `FakeSlotsRepository` follows: its rows carry `free` and a `rules` number (default 2), and its lists leave out `rules !== 2`.

- [ ] **Step 1: Write the failing DB tests.** Update the fixtures (stakes `20/40/60` etc., five stops, `free`, a lost 40 Silver round with whatever `slotJackpotAdd(shelf, 40)` gives) and add:

```ts
it('records all five stops, the free spins and rules 2', ...)
// bet with stops [1,2,3,4,5] and free [[6,7,8,9,10],[11,12,13,14,15]]: the row has bStop1..5 = 1..5, bRules = 2,
// szFree = '6,7,8,9,10;11,12,13,14,15'; spinsOf returns the same stops and free
it('moves the wallet by exactly the round: payout less stake', ...)
it('leaves an old three-reel row out of every list and keeps it in the totals', ...)
// insert a row by hand with bRules = 1 (the default) and llStake 50000, llPayout 0: spinsOf, latest, bigWins and
// jackpotWins do not return it; totals()[machine].allTime.spins counts it
it('leaves out a row whose free spins cannot be read', ...) // bRules = 2 with szFree = 'x'
it('a table from before this change gets the four columns', ...) // run the script twice: no error, columns there
```

Keep every existing pot, drop, refusal and settings case, with the fixtures changed.

- [ ] **Step 2: Rebuild shared, run and see them fail.** `npm run build -w packages/shared`, then in `apps/api` with the `_TEST` names set: `npx vitest run --config vitest.db.config.ts test/db/slots.db.test.ts`
- [ ] **Step 3: Implement** the script, the repository and the fake.
- [ ] **Step 4: Run again,** plus `test/db/roulette.db.test.ts`. Expected: PASS, roulette unchanged.
- [ ] **Step 5: Commit** `feat: a slots round on one row with its five stops and free spins`.

---

### Task 5: The API plays a whole round

**Files:**
- Modify: `apps/api/src/slots/slots.service.ts`, `apps/api/src/slots/slots.controller.ts`, `apps/api/test/slots.http.test.ts`

**Interfaces.**
- Consumes: `slotSpin`, `slotRoundPayout`, `slotJackpotAdd`, `SLOT_REEL_STOPS`, Task 4's `SlotBetInput`.
- Produces: `POST /api/slots/spin` answers `SlotSpinResult` whose `spin` is the new `SlotSpinView` (`stops` of five, `free`, `payout` for the round).

The order of draws, which tests replace through `service.random`: reel 1 to reel 5 of the paid spin; then, if it won free spins, reel 1 to 5 of each free spin in turn; then the jackpot's number, drawn only for a lost round while the jackpot is on. A free spin's scatters give nothing. The spin throttle becomes `limit: 45`.

- [ ] **Step 1: Write the failing tests.** The tests must not depend on the exact strips, so add a helper that scans for stops:

```ts
/** The first stops, counting reel 5 fastest, whose paid spin satisfies `want`. */
function stopsWhere(machine: SlotMachine, want: (out: SlotSpinOutcome) => boolean): SlotStops
const blank = stopsWhere(shelf, (o) => o.multiple === 0 && o.scatters < 3);
const paying = stopsWhere(shelf, (o) => o.multiple > 0 && o.freeSpins === 0);
const eightFree = stopsWhere(shelf, (o) => o.freeSpins === 8 && o.multiple === 0);
```

and a `draws(...numbers)` that makes `service.random` hand them out in order and fail the test when it runs out or is asked for one too many. Cases:

```ts
it('a paying round answers its five stops and pays the lines', ...)   // payout === slotRoundPayout(...), free [], no pot add, exactly 5 draws
it('a lost round feeds the pot and draws the jackpot number', ...)    // 6 draws; betCalls[0].add === slotJackpotAdd(shelf, 40)
it('three scatters play eight free spins in the same round', ...)
// draws: eightFree, then 8 x paying: spin.free has 8 entries equal to `paying`, payout === 8 x 2 x slotSpin(paying).multiple x 40 / 20,
// one bet call, exactly 45 draws, and no pot add although the paid spin itself paid nothing
it('free spins that all pay nothing make a lost round', ...)          // eightFree then 8 x blank: 46 draws, add > 0
it('scatters in a free spin give no more free spins', ...)            // eightFree then 8 x eightFree: free has 8 entries, 46 draws
it('refuses a stake that is not a multiple of 20 before anything is drawn', ...) // 422 from the schema, no draws, no bet
it('lets through 45 spins a minute for an account and refuses the 46th', ...)
it('refuses a spin with nothing taken when the columns are not there', ...) // repo.failing: 503 'Slots are not available right now', no wallet change
it('leaves a spin for a machine it does not know, or with stops it cannot show, out of the lists', ...)
```

Update every existing case to five stops and the new stakes; keep them all.

- [ ] **Step 2: Run and see them fail.** In `apps/api`: `npx vitest run test/slots.http.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement.** `stopsInRange` checks five stops; `spinViews` carries `free`.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: the slots API plays a round with its free spins in one money step`.

---

### Task 6: Five reels that turn, wait and stop

**Files:**
- Modify: `apps/web/src/lib/slots.ts`, `apps/web/src/lib/slots.test.ts`, `apps/web/src/lib/reel-blur.test.ts`, `apps/web/src/components/slots/Reels.tsx`
- Create: `apps/web/src/components/slots/Reels.test.tsx`, `apps/web/src/components/slots/WinLines.tsx`, `apps/web/src/components/slots/WinLines.test.tsx`

**Interfaces. Produces:**

```ts
// lib/slots.ts
export const SLOT_FIRST_STOP = 1.0;  // seconds until reel 1 rests
export const SLOT_STOP_GAP = 0.5;    // between one reel resting and the next
export const SLOT_SUSPENSE = 1.0;    // added before each reel that turns while two scatters already show
/** When each reel rests. `scatterOnReel[i]` is whether reel i shows a scatter. Quick halves all three times. */
export function reelTimes(scatterOnReel: readonly boolean[], quick: boolean): number[];
/** The reels that turn in suspense: every reel after the one that showed the second scatter. */
export function suspenseReels(scatterOnReel: readonly boolean[]): number[];
export type ReelPlan = { from: SlotStops; to: SlotStops; start: number[]; travel: number[]; times: number[] };
export function planReels(from: SlotStops, to: SlotStops, times: readonly number[]): ReelPlan;
export function reelsAt(plan: ReelPlan, seconds: number): number[];

// Reels.tsx
type ReelsProps = {
  machine: SlotMachine;
  rest: SlotStops;
  /** A new key starts a spin from the stops showing. */
  spin: { stops: SlotStops; key: string; times: readonly number[] } | null;
  animate: boolean;
  /** Tiles to light as [reel, row]; drawn only while the reels are at rest. */
  lit: readonly (readonly [number, number])[];
  /** A changed number stops turning reels at once on their stops. */
  stopNow: number;
  /** Once per reel per spin, in reel order, as each comes to rest. */
  onReelStopped: (reel: number) => void;
  /** Once per spin, after the last reel. Never after unmount. */
  onStopped: () => void;
  /** Drawn over the window: win lines, banners. */
  children?: ReactNode;
};

// WinLines.tsx
/** The given lines (indexes into SLOT_LINES) drawn across the window it is laid over. */
export function WinLines(props: { lines: readonly number[]; colour: string }): ReactNode;
/** All 20 lines as small 5 x 3 grids, numbered, for the pay table. */
export function LineMap(): ReactNode;
/** 'x,y x,y ...' through the middles of a line's five tiles in a 5 x 3 box. */
export function linePoints(line: number): string;
```

Motion: a reel's whole loops before its stop are `max(1, round(its time x 2))`, and never fewer than the reel before it, so speed stays about even. Stop now ends every reel still turning on its stop with the short settle and calls `onReelStopped` for each, in order, then `onStopped`. The cabinet colours stay. Tile and icon sizes: 56 px tiles with 48 px icons below 640 px wide; 76 px with 64 px icons from 640 px; 108 px with 96 px icons from 1024 px. The window strip count grows to five; the shading and the three-row window stay, but the win-line rules and end pointers on the middle row go (lines can be anywhere now).

- [ ] **Step 1: Write the failing tests.**

```ts
// lib/slots.test.ts
it.each([
  [[false, false, false, false, false], false, [1, 1.5, 2, 2.5, 3]],
  [[false, false, false, false, false], true, [0.5, 0.75, 1, 1.25, 1.5]],
  [[true, true, false, false, false], false, [1, 1.5, 3, 4.5, 6]],
  [[false, true, false, true, false], false, [1, 1.5, 2, 2.5, 4]],
  [[true, false, false, false, true], false, [1, 1.5, 2, 2.5, 3]],
  [[true, true, false, false, false], true, [0.5, 0.75, 1.5, 2.25, 3]],
])('reel times for scatters %j, quick %s', ...)
it.each([[[true, true, false, false, false], [2, 3, 4]], [[false, true, false, true, false], [4]], [[true, false, false, false, true], []]])('suspense reels', ...)
// planReels / reelsAt: starts where it was, ends on the stops (reelStop of each final position), never moves backward
// before the settle, each reel is at rest from its own time on, and a later reel never travels less than an earlier one

// WinLines.test.tsx
it('draws a line through the middle of its tiles', () => expect(linePoints(3)).toBe('0.5,0.5 1.5,1.5 2.5,2.5 3.5,1.5 4.5,0.5'));
it('draws one polyline per line given, and twenty numbered grids in the map', ...)

// Reels.test.tsx (fake requestAnimationFrame and performance, as slots.test.tsx does)
it('shows the three real rows of each of the five reels at rest', ...)
it('tells each reel stopping in order, then the spin', ...)   // onReelStopped 0,1,2,3,4 then onStopped once
it('stops at once when stopNow changes mid-spin', ...)          // advance 0.6 s, bump stopNow, one frame: all five told, onStopped once, tiles on the stops
it('lights the tiles it is given only at rest', ...)            // data-won on [reel,row]; none while turning
it('jumps to the result without animation', ...)                // animate false
it('never calls back after unmount', ...)
```

- [ ] **Step 2: Run and see them fail.** In `apps/web`: `npx vitest run src/lib/slots.test.ts src/lib/reel-blur.test.ts src/components/slots --maxWorkers=2`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: five slot reels with stop times, suspense and stop now`.

---

### Task 7: Sound

**Files:**
- Create: `apps/web/src/lib/slot-sounds.ts`, `apps/web/src/lib/slot-sounds.test.ts`

**Interfaces. Produces:**

```ts
export type SlotSound =
  | 'press' | 'reelStop' | 'scatter' | 'lineWin' | 'smallWin' | 'win' | 'bigWin' | 'hugeWin'
  | 'count' | 'freeStart' | 'freeEnd' | 'jackpot' | 'refused';
export type SlotSounds = {
  /** Does nothing until unlock() has run, while muted, or without a sound generator. `step` raises the pitch (the nth scatter, the nth line). */
  play(sound: SlotSound, step?: number): void;
  /** The turning reels: a loop that runs while on. */
  spinning(on: boolean): void;
  /** The rising sound while free spins are still possible. */
  suspense(on: boolean): void;
  /** Call from the player's first press. Safe to call on every press. */
  unlock(): void;
  readonly muted: boolean;
  /** Remembered in the browser under 'slots.sound' ('off' or 'on'). Muting stops both loops at once. */
  setMuted(muted: boolean): void;
  /** Stops both loops and anything scheduled. For unmount and for leaving the page. */
  stop(): void;
};
/** `make` builds the AudioContext; the default uses window.AudioContext, or webkitAudioContext, or returns null. */
export function createSlotSounds(make?: () => AudioContext | null): SlotSounds;
```

Every sound is built from oscillators and short noise bursts through one master gain; no files. Sound starts on, unless `'slots.sound'` says `'off'`. `smallWin` (a win below the stake) is one soft tick and nothing else.

- [ ] **Step 1: Write the failing tests** with a fake context that records `createOscillator`, `createBufferSource` and `resume` calls:

```ts
it('makes no sound and no context before the first press', ...)      // play('press') with no unlock: make not called
it('plays after unlock', ...)                                          // unlock(); play('reelStop'): at least one node started
it('creates one context however often it is unlocked', ...)
it('plays nothing while muted, and remembers the switch', ...)        // setMuted(true): no nodes; localStorage 'slots.sound' === 'off'; a new engine starts muted
it('starts with sound on when nothing is remembered', ...)
it('stops the turning loop when muted, on stop(), and when told off', ...)
it('does nothing, without throwing, when there is no sound generator', ...) // make returns null: every method is safe
it('does nothing, without throwing, when the context throws or stays suspended', ...) // make throws; resume() rejects
it('still switches when storage is blocked', ...)                     // localStorage.setItem throws: muted flips, no throw
it('has a recipe for every sound', ...)                               // each SlotSound name starts at least one node
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/lib/slot-sounds.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement.** Keep each sound short (under half a second, except `bigWin`, `hugeWin`, `freeStart` and `jackpot`, up to about two seconds) and the master gain modest. The owner will listen and ask for changes, so keep each sound's recipe in one small function.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: a sound engine for the slots, made in the browser`.

---

### Task 8: A round as something to show

**Files:**
- Create: `apps/web/src/lib/slot-round.ts`, `apps/web/src/lib/slot-round.test.ts`

**Interfaces.**
- Consumes: `slotSpin`, `SlotSpinOutcome`, `SlotSpinView`, `silverText`, `SLOT_FREE_MULTIPLIER`.
- Produces:

```ts
export type WinTier = 'none' | 'small' | 'win' | 'big' | 'huge';
/** none: nothing; small: less than the stake; win: up to 10 times it; big: 10 to 50 times; huge: 50 times or more. */
export function winTier(won: number, stake: number): WinTier;
export type RoundSpin = {
  stops: SlotStops;
  /** Null for the paid spin; 0, 1, 2... for a free spin. */
  free: number | null;
  outcome: SlotSpinOutcome;
  /** Silver this spin won, already doubled for a free spin. */
  won: number;
  /** The round's running total after this spin. */
  total: number;
};
/** The paid spin first, then the free spins in order. */
export function roundSpins(machine: SlotMachine, spin: Pick<SlotSpinView, 'stops' | 'free' | 'stake'>): RoundSpin[];
/** The tiles a spin's winning lines run through, as [reel, row], each once. */
export function wonTiles(outcome: SlotSpinOutcome): [number, number][];
/** The round in words. */
export function roundLine(spin: SlotSpinView, spins: RoundSpin[]): string;
/** A list entry: "Tranus's Shelf: staked 40 Silver, won 1 Gold 200 Silver with 8 free spins". */
export function roundListLine(machine: SlotMachine, spin: SlotSpinView): string;
```

`roundLine`, verbatim:

| The round | The line |
|---|---|
| won the jackpot | `Jackpot. This round made it drop. You won {jackpot} on a stake of {stake}.` |
| paid nothing, no free spins | `No win this time. You staked {stake}.` |
| paid nothing, with free spins | `{n} free spins won you nothing. You staked {stake}.` |
| paid, no free spins | `{k} lines won. You won {payout} on a stake of {stake}.` (`1 line won.` for one) |
| paid, with free spins | `{n} free spins won you {free total}. You won {payout} in all on a stake of {stake}.` (`nothing` when the free spins paid nothing) |

`roundListLine`: `{machine name}: staked {stake}, won {nothing | amount | the jackpot, amount}` and ` with {n} free spins` when there were any.

- [ ] **Step 1: Write the failing tests,** on the `showing(...)` fixture from Task 1 (copy the helper into `apps/web/src/test/slot-fixture.ts` so Tasks 9 and 10 can use it too):

```ts
it.each([[0, 40, 'none'], [39, 40, 'small'], [40, 40, 'win'], [399, 40, 'win'], [400, 40, 'big'], [1999, 40, 'big'], [2000, 40, 'huge']])('winTier(%i, %i) is %s', ...)
it('lists the paid spin and then each free spin with a doubled win and a running total', ...)
// the fixture round of Task 1 at stake 40: [{ free: null, won: 20, total: 20 }, { free: 0, won: 160, total: 180 }, { free: 1, won: 0, total: 180 }]
it('the last total is what the API paid', ...)   // equals slotRoundPayout
it('gives each winning tile once', ...)          // 'AACDE': reels 1 and 2 middle, once each, although three lines cross them
it.each([...])('says the round in words', ...)   // one case per row of the table, exact strings
it.each([...])('says a list entry', ...)         // nothing; an amount; the jackpot; with 8 free spins
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/lib/slot-round.test.ts --maxWorkers=2`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: a slots round as a list of spins to show, with its lines in words`.

---

### Task 9: What it pays

**Files:**
- Modify: `apps/web/src/components/slots/PayTable.tsx`, `apps/web/src/components/slots/symbol-icons.test.ts`
- Create: `apps/web/src/components/slots/PayTable.test.tsx`

**Interfaces.**
- Consumes: `SlotMachine`, the figures of Task 2, `LineMap` of Task 6.
- Produces: `PayTable({ machine, stake, stakes, jackpotLive })`, which now also draws everything under the table, so the page no longer builds those sentences.

What it shows, top to bottom:

1. One row per paying symbol, top prize first: its icon and name, and its prizes for 3, 4 and 5 as money at `stake` (prize x stake / 20). The lucky symbol's row also has its prize for 2.
2. The wild: icon, name, `Stands in for any symbol on a line, except the {scatter name}. Only on reels 2, 3 and 4.`
3. The scatter: icon, name, `3, 4 or 5 anywhere give 8, 12 or 20 free spins. Every win in a free spin is doubled.`
4. `20 win lines, all in play on every spin. A line pays from the left reel.` and the `LineMap`.
5. `This machine pays back {return, one decimal}% of what goes into it, over time, free spins counted. One round in {round(1 / (1 - lost rate))} pays something.`
6. `Free spins come about once in {round(1 / free rate)} rounds.`
7. `The most one paid spin can win at these stakes is {slotLargestWin}.`
8. Only when `jackpotLive`: `A lost round on this machine adds {share, one decimal}% of its stake to the jackpot. With the jackpot, the slots pay back everything staked, over time.`

On a phone the table must not push past the screen: prizes may wrap, and the 3 / 4 / 5 columns may stack under the symbol.

- [ ] **Step 1: Write the failing tests** against the fixture machine with hand-set `counts` (the second machine of Task 2's figures test, with `best: 4000`): each of the eight sentences above with its numbers worked out in the test; the prize for five of symbol 7 at stake 40 is `silverText(800 * 2)`; the jackpot sentence is absent when `jackpotLive` is false; the icon-file test covers all ten symbols of every real machine.
- [ ] **Step 2: Run and see them fail.** `npx vitest run src/components/slots --maxWorkers=2`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: the slots pay table shows lines, wild, scatter and the counted figures`.

---

### Task 10: The player page plays a round

**Files:**
- Modify: `apps/web/src/routes/_authed/slots.tsx`, `apps/web/src/routes/slots.test.tsx`
- Create: `apps/web/src/components/slots/WinShow.tsx`

**Interfaces.**
- Consumes: `Reels`, `WinLines` (Task 6), `createSlotSounds` (Task 7), `roundSpins`, `winTier`, `wonTiles`, `roundLine`, `roundListLine` (Task 8), `PayTable` (Task 9), `reelTimes`, `suspenseReels`, `useHeldSpin`, `useChosenCharacter`.
- Produces: the page. How the show is driven (one hook or several) is the implementer's call; it lives beside the page or in `lib/slot-round.ts`.

**The show, in order, for one press:**

1. The press: `sounds.unlock()`, the `press` sound, the stake leaves the wallet figure, the request goes (`held.send`, as today). A refused spin sounds `refused` and shows its message as today.
2. The answer: `roundSpins(...)`. The paid spin turns with `reelTimes(scatter on each reel, quick)`; the turning sound runs; each reel's stop sounds `reelStop`, or `scatter` with a rising step when that reel shows one; the suspense sound runs while a reel in `suspenseReels` turns.
3. Its lines: tiles from `wonTiles` lit; each winning line drawn in turn with `lineWin` (0.6 s each, 0.3 s quick, at most 2.4 s in all), then all together; the **Win** figure counts up to the running total, with `count` ticks while it moves.
4. If it won free spins: the banner `{n} free spins. Every win is doubled.` with `freeStart` for 2 s; then each free spin as steps 2 and 3 (no suspense: scatters give nothing there) under `Free spin {i} of {n}`, 0.4 s apart; then `{n} free spins won {amount}.` with `freeEnd`. A control `Skip to the total` is shown from the banner until the last free spin has stopped.
5. The end, by `winTier(round payout, stake)`: `none` nothing; `small` the `smallWin` tick; `win` the `win` sound and a 0.8 s count-up; `big` a `Big win` overlay with coins, `bigWin`, 3 s; `huge` a `Huge win` overlay, `hugeWin`, 5 s. A jackpot gets `jackpot` and the banner's celebration, as today.
6. Only now `held.reveal()`: the wallet, the pot, the lists and the result line (`roundLine`) change, and Spin comes back.

**Presses during the show.** Spin and the space bar, while a round is showing, never send a spin: on turning reels they stop them at once (`stopNow`); on a line show or a celebration they end it. `Skip to the total` jumps to step 6. With "reduce motion" the whole round jumps to step 6 with one sound for its tier.

**The page around it.**

- `main` widens to `max-w-4xl`; below 1024 px the layout is today's single column. From 1024 px "What it pays" sits beside the two lists.
- Under the reels: the stakes, the **Win** figure (labelled `Win`; shown from a round's first winning spin and kept until the next press), Spin, then two switches on one row: `Quick spin` and `Sound` (pressed states for assistive tech, remembered under `slots.quick` and by the sound engine). On a 360 x 560 screen Spin is still fully on the first screen when the page opens.
- The resting text is `Pick a stake, then press Spin.`; while a round shows, `Good luck...` (paid spin) or `Free spin {i} of {n}`.
- The lists become `Your last rounds` (empty: `You have not played yet.`) and `Big wins`, both using `roundListLine`; a big win reads `{character} won {amount} on {machine name}` or `{character} won the jackpot, {amount}`.
- The title, the tagline and the gambling sentence stay as they are.
- A remembered stake that is not offered falls to the machine's lowest silently, as today for one remembered from an earlier visit.
- Unmount, or switching machine (still refused while busy), clears every timer and calls `sounds.stop()`.

- [ ] **Step 1: Write the failing tests.** Rework `slots.test.tsx`: fixtures get five stops, `free`, stakes `20/40/60`; keep every existing case that still applies (states, refusals, the stake rules, one press sends one spin, the held wallet and pot, the jackpot line, the poll, remembered choices). Replace `SLOT_MACHINES` in the page's tests with real machines plus `stopsWhere` (Task 5's helper, copied into `apps/web/src/test/slot-fixture.ts`) so results do not depend on the strips. Pass a fake `SlotSounds` that records calls (export a way to inject it, for example a module-level `setSlotSoundsForTest`, or a prop on the floor component). Add:

```ts
it('holds the wallet and the pot until the whole round, free spins included, has been shown', ...)
it('plays eight free spins by themselves after one press and sends one request', ...) // 'Free spin 1 of 8' ... 'Free spin 8 of 8', then the total
it('a press while the reels turn stops them and sends nothing', ...)
it('a press during a celebration ends it and sends nothing', ...)
it('Skip to the total ends the free spins at once with the right wallet', ...)
it('a win below the stake gets the small tick and no win sound or overlay', ...)
it('a win of ten times the stake shows Big win; fifty times shows Huge win', ...)
it('sounds each reel as it stops, a scatter instead where one landed, and never before its reel has stopped', ...)
it('runs the suspense sound only while a reel turns after two scatters are showing', ...)
it('calls no sound before the first press', ...)
it('the Sound switch mutes and is remembered; Quick spin halves the reel times and is remembered', ...)
it('with reduce motion the round is shown at once with one sound', ...)
it('leaving the page mid-round stops the sound and sets nothing afterwards', ...)   // unmount during free spins: sounds.stop called, no act warnings, no timers left
it('a remembered stake of 25 becomes the lowest stake without a note', ...)
it('says each round in the lists, with its free spins', ...)
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/routes/slots.test.tsx --maxWorkers=2`
- [ ] **Step 3: Implement** the page and `WinShow` (the big win, huge win and free spins banners over the window; coins as a CSS animation, none with reduce motion).
- [ ] **Step 4: Run again,** with `src/routes/nav.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the slots page plays a round with lines, free spins, celebrations and sound`.

---

### Task 11: The GM page, the rollout script, and the whole suite

**Files:**
- Modify: `apps/web/src/routes/_authed/gm/slots.tsx`, `apps/web/src/routes/gm-slots.test.tsx`
- Modify: `docs/superpowers/specs/2026-11-14-slots-design.md` (one line under the title: `The machines and rules here were replaced on 2026-11-15: see 2026-11-15-slots-modern-design.md.`) and `docs/superpowers/specs/2026-11-15-slots-jackpot-design.md` (one line under the title: `What counts as a lost round, and the share it adds, changed on 2026-11-15: see 2026-11-15-slots-modern-design.md.`)
- Create, outside the repo: `C:\Users\stath\Documents\4Story\4s\db_changes\2026-11-15-portal-slots-modern\apply.sql` and `undo.sql`, laid out like `db_changes\2026-11-15-portal-slots-jackpot`
- Modify, outside the repo: `C:\Users\stath\Documents\4Story\4s\GAME_CHANGES_LEDGER.md`

- [ ] **Step 1: Write the failing GM tests:** stakes `10, 25, 50` are refused in the form with `Enter three different stakes in multiples of 20 Silver, lowest first` and nothing is sent; each machine shows its return from the stored counts and `The most one paid spin can win at these stakes is ...`; a latest round with free spins reads `... with 8 free spins`; fixtures move to five stops and the new stakes, every other case kept.
- [ ] **Step 2: Run and see them fail,** implement, run again. `npx vitest run src/routes/gm-slots.test.tsx --maxWorkers=2`. Expected: PASS.
- [ ] **Step 3: Write `apply.sql` and `undo.sql`** against `TGAME_GSP`: the four columns, safe to run twice; the top of `apply.sql` says it needs `2026-11-14-portal-slots` and `2026-11-15-portal-slots-jackpot` first. Undo drops the four columns and their defaults, and notes that five-reel rounds then lose their free spins and last two stops. **Do not run either.**
- [ ] **Step 4: Add the ledger entry,** status "written, not applied": what it adds, that no game server restart is needed, that the SQL goes in before the new API spins against that database, that GM-saved stakes not in multiples of 20 Silver fall back to the starting stakes, and the undo steps.
- [ ] **Step 5: Run everything.** From the repo root: `npm run build -w packages/shared`; `npm run lint`; then per package `npx vitest run --maxWorkers=2` in `packages/shared`, `apps/api` and `apps/web`; then the API's DB suite for slots and roulette with the `_TEST` names. Expected: all PASS, lint clean. Report the real output of each.
- [ ] **Step 6: One watched browser check.** Say what will be started before starting it. Build the web app once (`npx vite build` in `apps/web`), serve `dist` with a tiny static server that answers `/api/me`, `/api/slots` and `POST /api/slots/spin` with canned JSON (a lost round, a three-line win, a round with eight free spins, a huge win), and drive ONE headless Edge over its debugging port, watching CPU and memory and stopping if the machine struggles. Check only: at 360 x 560 the five reels fit and Spin is fully on the first screen; at 1280 x 800 the cabinet and lists lay out as designed; a drawn win line passes through the middle of its lit tiles at both sizes; the free spins banner and the Big win overlay sit inside the window. Close the browser and the server and confirm no process is left. Fix what it shows and rerun the affected tests.
- [ ] **Step 7: Commit** `feat: the GM slots page follows the five-reel machines` and, separately, `docs: the first slots designs point at the five-reel design`.
- [ ] **Step 8: Tell the owner what only they can judge:** every sound and its loudness on a desktop and a phone; the twelve new icons; how the celebrations feel; the reels' blur on iOS Safari (an SVG filter through CSS, never checked there).
