# Slots Jackpot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One jackpot shared by the three slot machines: every lost round adds the machine's own keep to a pot that must be won before a GM-set cap, and the lost round that makes it drop wins it.

**Architecture:** The share a lost round adds and the rule that decides a drop are pure functions in `packages/shared`, counted from the reel strips like the return. The pot is one row in a new table; the spin's existing money batch (`walletBetSql`) gains a slot for a game's own step, and the slots repository uses it to lock the pot, add to it, decide the drop and pay it, all in the spin's transaction. The pages read the pot from the slots state they already poll.

**Tech Stack:** NestJS + mssql + zod (API), React 19 + TanStack Router/Query + Tailwind (web), vitest, SQL Server.

**Spec:** `docs/superpowers/specs/2026-11-15-slots-jackpot-design.md`. Read it first, then `docs/superpowers/specs/2026-11-14-slots-design.md`, which it adds to. The code to read: `packages/shared/src/slots.ts`, `apps/api/src/slots/`, `apps/api/src/games/wallet-bet.ts`, `apps/api/test/fakes.ts` (`FakeSlotsRepository`), `apps/api/test/slots.http.test.ts`, `apps/api/test/db/slots.db.test.ts`, `apps/web/src/routes/_authed/slots.tsx`, `apps/web/src/routes/_authed/gm/slots.tsx`, `apps/web/src/lib/slots.ts`, `apps/web/src/lib/wallet-game.ts`, `apps/web/src/routes/slots.test.tsx`, `apps/web/src/routes/gm-slots.test.tsx`. Copy their patterns unless this plan says otherwise.

## Global Constraints

- **Never edit or print `.env`.** It names the live databases. Run DB tests with `DB_GLOBAL_NAME=TGLOBAL_GSP_TEST DB_GAME_NAME=TGAME_GSP_TEST` set in the shell. A worktree has no `.env`: load the main one into the shell first, then set those two names.
- **Never run SQL against `TGAME_GSP` or `TGLOBAL_GSP`.** Only the `_TEST` copies, and DB tests roll everything back. Applying the script anywhere else waits for the owner.
- **No dev servers, no browsers, no screenshots, no `nest build`.** Vitest only, affected files only, with `--maxWorkers=2`.
- **Run every test command from a folder spelled with a capital `C:`** (`cd "C:/Users/..."`). From a lowercase `c:` folder vitest fails every file with "failed to find the current suite".
- `@4story-portal/shared` is consumed from `dist`: after changing it run `npm run build -w packages/shared` before API or web tests.
- Money on the wire is whole **Silver** (1 Gold = 1000 Silver), and a wallet is `{ gold, silver, copper }`. In the database money is **Bronze** in `BIGINT` (1 Silver = 1000 Bronze); the mssql driver returns `BIGINT` as a string, so convert with `Number()`. Only the pot and what a round adds are kept to the Bronze.
- A lost round is a spin whose line pays nothing (`multiple === 0`). It adds `floor(stake in Bronze x (combos - paid) / (combos - hits))`. A spin that pays adds nothing. Nothing is ever rounded up.
- The cap is whole Gold, 1 to 10,000, starting at 50. The floor is a tenth of the cap. A pot takes the cap set when its first lost round is added and keeps it until it drops.
- A drop pays the pot's whole Silver; the odd Bronze stays as the next pot.
- Missing setting rows mean the jackpot is on with a 50 Gold cap. The pot starts empty.
- The reels, payout tables and every existing refusal stay exactly as they are. Roulette's tests pass unchanged.
- The game calls the coins Gold, Silver and Bronze in everything a person reads. Code and columns keep `copper` / `dwCooper`.
- UI copy is plain ASCII punctuation, sentence case, no exclamation marks. Exact strings in this plan are verbatim.
- Commits: `feat:` / `fix:` / `test:` / `docs:` prefix, ending with the `Co-Authored-By:` line the committing session is given. Work on branch `feat/slots-jackpot`, never on `main`.

## Review Focus

1. **The jackpot's table is not in the database yet while the new API runs:** the slots page still opens, with no banner; a spin is refused with "Slots are not available right now" and takes nothing. (Tasks 3 and 4)
2. **A hand-edited cap setting** (`abc`, `0`, `10001`, `12.5`): read as 50 Gold, never as no cap or a zero cap. (Task 3)
3. **The pot at or past its cap, or emptied by someone else between two polls:** the bar never shows more than full, the figure just follows, and nothing on the page breaks when "Last won by" changes under the player. (Task 5)
4. **A GM switches the jackpot off and on again mid-pot:** the pot and the cap it runs under are both kept, and no round played while it was off added anything. (Tasks 3 and 4)
5. **A pot that has never been fed, or holds only odd Bronze after a drop:** the banner shows "0 Silver" and the cap that is set now, not a blank or a stale cap. (Tasks 4 and 5)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/slots.ts` | Adds the share a lost round feeds, the drop rule, the cap limits, the jackpot's view types and its settings schema |
| `apps/api/sql/TPORTALSLOTJACKPOT.sql` | New: the one-row pot table |
| `apps/api/sql/TPORTALSLOTSPIN.sql` | Gains the two columns, for a new table and for one already there |
| `apps/api/src/games/wallet-bet.ts` | The shared money batch gains a slot for a game's own step and an `@extra` amount |
| `apps/api/src/slots/slots.repository.ts` | The pot step inside the bet, jackpot settings, the pot, its wins and totals |
| `apps/api/src/slots/slots.service.ts`, `slots.controller.ts` | What a round adds, the draw, the jackpot in the state, the GM route |
| `apps/api/src/auth/account-throttler.guard.ts` | New: a throttle counted by account |
| `apps/web/src/components/slots/JackpotBanner.tsx` | New: the banner |
| `apps/web/src/routes/_authed/slots.tsx`, `_authed/gm/slots.tsx`, `apps/web/src/lib/slots.ts` | The banner, lines and lists on the player page; the jackpot section on the GM page; the save and the poll |

---

### Task 1: The share a lost round adds, and the drop rule

**Files:**
- Modify: `packages/shared/src/slots.ts`, `packages/shared/src/slots.test.ts`
- Modify: `docs/superpowers/specs/2026-11-14-slots-design.md` (under "Not in this version", change the jackpot line to `- A growing jackpot fed by a slice of every bet. (Added on 2026-11-15: see 2026-11-15-slots-jackpot-design.md.)`)
- Commit also: `docs/superpowers/specs/2026-11-15-slots-jackpot-design.md`, `docs/superpowers/plans/2026-11-15-slots-jackpot.md`

**Interfaces — Produces** (new exports only; nothing existing changes in this task):

```ts
export const SLOT_JACKPOT_DEFAULT_CAP = 50;   // whole Gold
export const SLOT_JACKPOT_MIN_CAP = 1;
export const SLOT_JACKPOT_MAX_CAP = 10_000;
/** The jackpot's random draw is a whole number from 0 up to (not including) this. */
export const SLOT_JACKPOT_ROLLS = 1_000_000_000;
export const BRONZE_PER_SILVER = 1000;
export const BRONZE_PER_GOLD = 1_000_000;

/** The share of a lost stake that goes to the pot, as two whole numbers: (combos - paid) / (combos - hits). */
export function slotJackpotShare(machine: SlotMachine): { num: number; den: number };
/** What a lost round of `stake` Silver adds to the pot, in whole Bronze, rounded down. */
export function slotJackpotAdd(machine: SlotMachine, stake: number): number;
/**
 * Whether the lost round that adds `add` to a pot of `pot` under `cap` makes it drop. All three in Bronze;
 * `roll` is a whole number from 0 up to SLOT_JACKPOT_ROLLS. The database step does the same sum.
 */
export function slotJackpotDrops(pot: number, add: number, cap: number, roll: number): boolean;

export const slotJackpotSettingsSchema;  // { live: boolean, cap: int SLOT_JACKPOT_MIN_CAP..SLOT_JACKPOT_MAX_CAP }
export type SlotJackpotSettingsInput;
/** What players see. All money whole Silver, rounded down. */
export type SlotJackpot = {
  live: boolean;
  pot: number;
  /** The cap this pot runs under; the cap set now while the pot has none. */
  cap: number;
  /** A tenth of the cap. */
  floor: number;
  last: { character: string; amount: number; at: string } | null;
};
```

`slotJackpotDrops` is the spec's rule, in `BigInt` so a 10,000 Gold cap cannot overflow:

```ts
const floor = cap / 10n;                       // whole Bronze, rounded down
const from = pot > floor ? pot : floor;
const to = pot + add > floor ? pot + add : floor;
if (from >= cap) return true;
return roll * (cap - from) < (to - from) * BigInt(SLOT_JACKPOT_ROLLS);
```

- [ ] **Step 1: Write the failing tests** in `slots.test.ts`:

```ts
it.each([
  ['shelf', 1368, 24564],
  ['armoury', 1408, 27331],
  ['hoard', 1279, 29493],
])('a lost round on %s adds %i / %i of its stake', (key, num, den) =>
  expect(slotJackpotShare(slotMachine(key)!)).toEqual({ num, den }));

it.each([
  ['shelf', 50, 2784],
  ['shelf', 10, 556],
  ['armoury', 100, 5151],
  ['hoard', 200, 8673],
])('a lost %s round of %i Silver adds %i Bronze', (key, stake, bronze) =>
  expect(slotJackpotAdd(slotMachine(key)!, stake)).toBe(bronze));

it('pays back exactly the stakes before rounding, and never more after it', () => {
  for (const machine of SLOT_MACHINES) {
    const { combos, paid, hits } = slotOdds(machine);
    const { num, den } = slotJackpotShare(machine);
    expect(paid * den + (combos - hits) * num).toBe(combos * den);
    for (const stake of [1, ...machine.stakes, SLOT_MAX_STAKE]) {
      const bronze = stake * 1000;
      expect(paid * bronze + (combos - hits) * slotJackpotAdd(machine, stake)).toBeLessThanOrEqual(combos * bronze);
    }
  }
});

const CAP = 50_000_000; // 50 Gold: the floor is 5_000_000
it.each([
  ['below the floor it cannot drop', 1_000_000, 2784, CAP, 0, false],
  ['across the floor only the part past it counts', 4_999_000, 2784, CAP, 39_644, true],
  ['across the floor, one roll higher', 4_999_000, 2784, CAP, 39_645, false],
  ['between floor and cap', 27_500_000, 2784, CAP, 123_733, true],
  ['between floor and cap, one roll higher', 27_500_000, 2784, CAP, 123_734, false],
  ['a round that passes the cap always wins', 49_998_000, 2784, CAP, 999_999_999, true],
  ['a round that lands exactly on the cap always wins', 49_997_216, 2784, CAP, 999_999_999, true],
  ['a pot already past its cap always drops', 60_000_000, 2784, CAP, 999_999_999, true],
  ['a 10,000 Gold cap does not overflow', 5_000_000_000, 8673, 10_000_000_000, 999_999_999, false],
  ['a 10,000 Gold cap, the lowest roll', 5_000_000_000, 8673, 10_000_000_000, 0, true],
])('%s', (_name, pot, add, cap, roll, drops) => expect(slotJackpotDrops(pot, add, cap, roll)).toBe(drops));

it.each([0, 10_001, 1.5])('refuses a cap of %s', (cap) =>
  expect(slotJackpotSettingsSchema.safeParse({ live: true, cap }).success).toBe(false));
it('accepts a cap from 1 to 10,000 Gold', () => {
  expect(slotJackpotSettingsSchema.parse({ live: false, cap: 1 })).toEqual({ live: false, cap: 1 });
  expect(slotJackpotSettingsSchema.safeParse({ live: true, cap: 10_000 }).success).toBe(true);
});
```

- [ ] **Step 2: Run them and see them fail.** `cd "C:/Users/stath/Projects/4story-portal/<worktree>"`, then `npm test -w packages/shared -- src/slots.test.ts --maxWorkers=2`. Expected: FAIL, `slotJackpotShare is not a function`.
- [ ] **Step 3: Implement the exports above** in `slots.ts`, beside `slotOdds`. `slotJackpotAdd` is `Math.floor((stake * 1000 * num) / den)` (at most 1e8 x 1408, well inside a double's whole numbers).
- [ ] **Step 4: Run the file again.** Expected: PASS, the existing tests included.
- [ ] **Step 5: Build and commit.** `npm run build -w packages/shared`, then commit the two shared files, both specs and this plan: `feat: the share a lost slots round adds to the jackpot, and the rule for its drop`.

---

### Task 2: The tables, and a slot in the money batch for a game's own step

**Files:**
- Create: `apps/api/sql/TPORTALSLOTJACKPOT.sql`
- Modify: `apps/api/sql/TPORTALSLOTSPIN.sql`, `apps/api/src/games/wallet-bet.ts`, `apps/api/src/db/db.service.ts`, `apps/api/test/table-names.test.ts`, `apps/api/test/db/roulette.db.test.ts` (new tests only)

**Interfaces — Produces:**

```ts
// db.service.ts: tables gains
slotJackpot: `${game}.TPORTALSLOTJACKPOT`

// wallet-bet.ts
/**
 * `before` is the game's own SQL, run once every check has passed and before the wallet is written. It may set
 * @extra (BIGINT Bronze, 0 until then), which is paid into the wallet with @payout. `record` may use @extra.
 * The result row gains `extra` (BIGINT, so a string from the driver).
 */
export function walletBetSql(tables: BetTables, liveKey: string, record: string, before?: string): string;
```

SQL, all additive and safe to run twice:

- `TPORTALSLOTJACKPOT`: `bID TINYINT NOT NULL` primary key with `CHECK (bID = 1)`; `llPot BIGINT NOT NULL` default 0 (Bronze); `llCap BIGINT NULL` (Bronze: the cap this pot runs under, NULL until a lost round first adds to it). The script inserts row 1 when it is missing. Head comment in the style of `TPORTALSLOTSPIN.sql`.
- `TPORTALSLOTSPIN`: `llAdded BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llAdded DEFAULT 0` (Bronze this spin added to the pot) and `llJackpot BIGINT NOT NULL CONSTRAINT DF_TPORTALSLOTSPIN_llJackpot DEFAULT 0` (Bronze it was paid from the pot). Add both to the `CREATE TABLE`, and after it an `IF COL_LENGTH('dbo.TPORTALSLOTSPIN', 'llAdded') IS NULL ALTER TABLE ... ADD` for a table already there.

In the batch: declare `@extra BIGINT = 0`; run `before` inside the `IF @code = 0` block that writes the wallet, first; after it `IF @extra IS NULL OR @extra < 0 THROW 50000, 'Extra cannot be negative', 1;`; the wallet becomes `@wallet - @stake + @payout + @extra`; the final `SELECT` adds `@extra AS extra`.

- [ ] **Step 1: Write the failing tests.** In `table-names.test.ts` add `slotJackpot: '[TGAME_GSP_TEST].dbo.TPORTALSLOTJACKPOT'`. In `roulette.db.test.ts`, beside the existing direct `walletBetSql(db.tables, ROULETTE_LIVE_KEY, 'SELECT 1')` test and with its setup:
  - `'pays what a game\'s own step sets as extra, with the payout'`: `before` is `SET @extra = 1500`, stake 50,000, payout 0; the wallet falls by 48,500 Bronze and the row has `Number(extra) === 1500`.
  - `'does not run a game\'s own step on a refusal'`: the table closed, `before` is `THROW 50001, 'ran', 1`; the answer is `code: BET_CLOSED` and nothing throws.
  - `'refuses a negative extra and writes nothing'`: `before` is `SET @extra = -1`; the query rejects and the wallet is unchanged.
- [ ] **Step 2: Run and see them fail.** `npm test -w apps/api -- test/table-names.test.ts --maxWorkers=2` and `DB_GLOBAL_NAME=TGLOBAL_GSP_TEST DB_GAME_NAME=TGAME_GSP_TEST npm run test:db -w apps/api -- test/db/roulette.db.test.ts --maxWorkers=2`. Expected: FAIL on the new cases only.
- [ ] **Step 3: Implement** the table name, the two scripts and the batch change. Update the doc comment on `walletBetSql`.
- [ ] **Step 4: Run both commands again**, plus `test/db/slots.db.test.ts`. Expected: PASS, every existing roulette and slots case unchanged.
- [ ] **Step 5: Commit.** `feat: the jackpot's table and spin columns, and a slot in the money batch for a game's own step`.

---

### Task 3: The pot in the slots repository

**Files:**
- Modify: `apps/api/src/slots/slots.repository.ts`, `apps/api/test/db/slots.db.test.ts`, `apps/api/test/fakes.ts` (`FakeSlotsRepository`)

**Interfaces — Consumes:** `walletBetSql(..., before)` and `tables.slotJackpot` (Task 2); `slotJackpotDrops`, `SLOT_JACKPOT_DEFAULT_CAP`, `SLOT_JACKPOT_MIN_CAP`, `SLOT_JACKPOT_MAX_CAP`, `SLOT_JACKPOT_ROLLS` (Task 1).

**Interfaces — Produces:**

```ts
export const SLOTS_JACKPOT_LIVE_KEY = 'slots_jackpot_live';
export const SLOTS_JACKPOT_CAP_KEY = 'slots_jackpot_cap';

export type SlotSettings = { live: boolean; machines: ...; jackpot: { live: boolean; /** Whole Gold. */ cap: number } };
/** `jackpot` is whole Silver, 0 for a spin that did not win it. */
export type SlotSpinRow = { ...as now; jackpot: number };
/** `add` is Bronze, 0 to leave the pot alone. `cap` is whole Gold: the cap set now, taken by a pot that has none. */
export type SlotBetInput = { ...as now; add: number; cap: number; roll: number };
export type SlotBetOutcome =
  | { code: typeof BET_OK; id: number; wallet: Wallet; /** Whole Silver won from the pot. */ jackpot: number }
  | { code: Exclude<BetCode, typeof BET_OK>; name: string | null };
/** `added` is whole Silver, rounded down. */
export type SlotTotalsRow = { spins: number; staked: number; paid: number; added: number };
/** Both Bronze; `cap` is null until a lost round first adds to this pot. */
export type SlotPotRow = { pot: number; cap: number | null };
/** `added` is Bronze, `paid` whole Silver. */
export type SlotJackpotTotalsRow = { added: number; paid: number; drops: number };

interface SlotsRepository {
  bet(input: SlotBetInput): Promise<SlotBetOutcome>;
  saveJackpot(settings: { live: boolean; cap: number }, changedBy: string): Promise<void>;
  /** Throws when the jackpot's table is not there. */
  pot(): Promise<SlotPotRow>;
  /** Spins that won the jackpot, newest first. */
  jackpotWins(limit: number): Promise<SlotSpinRow[]>;
  jackpotTotals(): Promise<SlotJackpotTotalsRow>;
  // bigWins now also returns spins that won the jackpot.
}
```

Settings: the jackpot is on when its row is missing, otherwise read with `settingIsOn`; the cap is the row's value when it is digits only and from 1 to 10,000, otherwise 50.

The pot step, passed to `walletBetSql` as `before` only when `input.add > 0` (binds `@add BIGINT`, `@nextCap BIGINT` = cap x 1,000,000, `@roll BIGINT`; otherwise bind `@add` as 0 and pass no `before`). The record's INSERT writes `@add` to `llAdded` and `@extra` to `llJackpot`; `llPayout` stays the line's payout.

```sql
DECLARE @pot BIGINT, @cap BIGINT, @from BIGINT, @to BIGINT;
SELECT @pot = llPot, @cap = ISNULL(llCap, @nextCap) FROM <slotJackpot> WITH (UPDLOCK, ROWLOCK) WHERE bID = 1;
IF @pot IS NULL THROW 50001, 'The jackpot row is missing', 1;
SET @from = CASE WHEN @pot > @cap / 10 THEN @pot ELSE @cap / 10 END;
SET @pot = @pot + @add;
SET @to = CASE WHEN @pot > @cap / 10 THEN @pot ELSE @cap / 10 END;
IF @from >= @cap OR CAST(@roll AS DECIMAL(38,0)) * (@cap - @from) < CAST(@to - @from AS DECIMAL(38,0)) * 1000000000
BEGIN
  SET @extra = (@pot / 1000) * 1000;
  UPDATE <slotJackpot> SET llPot = @pot % 1000, llCap = NULL WHERE bID = 1;
END
ELSE UPDATE <slotJackpot> SET llPot = @pot, llCap = @cap WHERE bID = 1;
```

`FakeSlotsRepository` gains `potRow: SlotPotRow = { pot: 0, cap: null }` and `potMissing = false` (when true, `pot()` rejects, and so does a `bet` with `add > 0`, before it touches a wallet). Its `bet` follows the same steps with `slotJackpotDrops`, pays the jackpot with the payout through `wallets.move`, and changes the pot only when the wallet step accepted. Its rows keep `added` (Bronze) and `jackpot` (Silver).

- [ ] **Step 1: Write the failing DB tests** in `slots.db.test.ts`. Add `'TPORTALSLOTJACKPOT.sql'` to `setupSql`; in `withRepo`, reset the pot (`UPDATE ... SET llPot = 0, llCap = NULL`); add `llAdded`/`llJackpot` to `SpinTableRow`, `add: 0, cap: 50, roll: 999_999_999` to the `bet` helper's defaults, `jackpot: 0` and `added: 0` to the existing expectations that list whole rows and totals; add helpers `potOf(tx)` and `setPot(tx, pot, cap)`. `START` is 5 Gold 250 Silver 999 Bronze. New cases, all with the floor open:

  | Test | Given | Expect |
  |---|---|---|
  | `a lost round adds to the pot and fixes its cap` | `bet({ stake: 50, payout: 0, multiple: 0, add: 2784 })` | pot `{ pot: 2784, cap: 50_000_000 }`; wallet 5 Gold 200 Silver 999 Bronze; row `llAdded` 2784, `llJackpot` 0; outcome `jackpot: 0` |
  | `a round that pays leaves the pot alone` | `bet({ payout: 2500, multiple: 50, add: 0 })` | pot `{ pot: 0, cap: null }`; row `llAdded` 0 |
  | `a round that reaches the cap wins the whole Silver and leaves the odd Bronze` | `setPot(49_999_500, 50_000_000)`, then the lost round above | outcome `jackpot: 50_002`, wallet `{ gold: 55, silver: 202, copper: 999 }` in both the outcome and the table; pot `{ pot: 284, cap: null }`; row `llPayout` 0, `llJackpot` 50_002_000, `llAdded` 2784, `llWallet` 55_202_999, `wMultiple` 0 |
  | `the roll decides between floor and cap` | `setPot(27_500_000, 50_000_000)`; `roll: 123_734` then, from the same start, `roll: 123_733` | first: no drop, pot 27_502_784; second: `jackpot: 27_502`, pot `{ pot: 784, cap: null }` |
  | `a pot keeps its cap when the cap set changes, and the next pot takes the new one` | `setPot(10_000_000, 50_000_000)`; lost round with `cap: 20, roll: 999_999_999`; then `setPot(49_999_500, 50_000_000)`, a lost round that drops it, and one more lost round with `cap: 20` | after the first: pot `{ pot: 10_002_784, cap: 50_000_000 }`; at the end: `cap: 20_000_000` |
  | `a refused spin leaves the pot alone` | the character in the game, lost round with `add: 2784` | `BET_ONLINE`; pot `{ pot: 0, cap: null }` |
  | `the pot is always what was added less what was paid` | a run of 6 lost rounds across the three machines with `add` values and rolls that include one drop | `llPot = SUM(llAdded) - SUM(llJackpot)` over the spin table |
  | `reads the jackpot on with a 50 Gold cap before anything is saved, and saves it` | fresh; then `saveJackpot({ live: false, cap: 80 }, 'otter')` | `settings().jackpot` is `{ live: true, cap: 50 }`, then `{ live: false, cap: 80 }`, with rows `slots_jackpot_live` = `false` and `slots_jackpot_cap` = `80` by `otter` |
  | `it.each(['abc', '0', '10001', '12.5'])('falls back to a 50 Gold cap when the setting holds %s')` | save, then overwrite the cap row raw | `settings().jackpot.cap` is 50, and the switch beside it still reads as saved |
  | `lists jackpot wins, and among the big wins` | one drop of 50_002 Silver, one 50-times win, one loss | `jackpotWins(10)` is the drop only, with `jackpot: 50_002`; `bigWins(10)` is both, newest first |
  | `adds up what went to the jackpot` | lost rounds adding 2784 and 5151 on two machines, one of them dropping | `totals()` per machine has `added` in whole Silver (2 and 5); `jackpotTotals()` has `added` in Bronze, `paid` in Silver and `drops: 1` |

  The missing-table case has no DB test, because the setup creates the table: Task 4 covers it with the fake's `potMissing`.

- [ ] **Step 2: Run and see them fail.** `DB_GLOBAL_NAME=TGLOBAL_GSP_TEST DB_GAME_NAME=TGAME_GSP_TEST npm run test:db -w apps/api -- test/db/slots.db.test.ts --maxWorkers=2`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement the repository** as in the Interfaces block, then the fake to match.
- [ ] **Step 4: Run the DB file again, and roulette's.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: a lost slots round feeds the pot in the spin's own transaction, and the round that drops it is paid`.

---

### Task 4: The API

**Files:**
- Create: `apps/api/src/auth/account-throttler.guard.ts`
- Modify: `packages/shared/src/slots.ts` (view types), `apps/api/src/slots/slots.service.ts`, `apps/api/src/slots/slots.controller.ts`, `apps/api/test/slots.http.test.ts`
- Modify, fixtures only, so the web still type-checks: `apps/web/src/routes/slots.test.tsx`, `apps/web/src/routes/gm-slots.test.tsx` and any other file `npm run lint -w apps/web` names (add `jackpot: null` to states, `jackpot: 0` to spins, `added: 0` to totals; the pages then behave as before)

**Interfaces — Consumes:** Task 3's repository; `slotJackpotAdd`, `SLOT_JACKPOT_ROLLS`, `slotJackpotSettingsSchema`, `SlotJackpot` (Task 1).

**Interfaces — Produces** (in `packages/shared/src/slots.ts`):

```ts
export type SlotSpinView = { ...as now; /** Whole Silver won from the pot, 0 for a spin that did not win it. */ jackpot: number };
export type SlotsState = { ...as now; /** Null when the jackpot cannot be read. */ jackpot: SlotJackpot | null };
export type SlotTotals = { spins: number; staked: number; paid: number; /** Whole Silver that went to the jackpot. */ added: number };
/** All money whole Silver, rounded down. */
export type GmSlotJackpot = {
  live: boolean;
  /** The cap set for the next jackpot, whole Gold. */
  setCap: number;
  /** Null when the pot cannot be read. `cap` is what this pot runs under: the set cap while it has none. */
  running: { pot: number; cap: number; floor: number } | null;
  added: number;
  paid: number;
  drops: number;
  /** The latest 10 drops, newest first. */
  wins: SlotSpinView[];
};
export type GmSlots = { ...as now; jackpot: GmSlotJackpot };
```

Route: `PUT /api/gm/slots/jackpot`, body `slotJackpotSettingsSchema`, GM only, throttled like the other GM saves, answers `GmSlots`. Audit row: command `SLOTS`, log `JACKPOT on cap 50` / `JACKPOT off cap 80`.

`AccountThrottlerGuard extends ThrottlerGuard`, overriding `getTracker` to return `account:<userId>` from `req.user` (set by `SessionGuard`, which runs first because it is on the controller), and the IP when there is no user. `POST /slots/spin` uses it with `limit: 30, ttl: 60_000`.

Service rules:
- A spin adds `slotJackpotAdd(machine, stake)` when its multiple is 0 and the jackpot is on, otherwise 0. The jackpot's roll is drawn with `this.random(SLOT_JACKPOT_ROLLS)` only when it adds something, after the three stops. The bet is sent with `add`, `cap: settings.jackpot.cap` and `roll`.
- `state()` reads the pot and the latest jackpot win with `readOr`; `jackpot` is null when the pot cannot be read. `pot` is `floor(bronze / 1000)`; `cap` is the pot's own cap in Silver, or the set cap x 1000 while the pot has none; `floor` is `floor(cap / 10)`.
- `gmState()` always answers `jackpot` (settings fall back to on and 50), with `running: null` and zero totals when the pot cannot be read.
- `CLOSED` gains `jackpot: { live: true, cap: SLOT_JACKPOT_DEFAULT_CAP }`.

- [ ] **Step 1: Write the failing HTTP tests** in `slots.http.test.ts` (update the existing whole-body expectations with `jackpot` and `added` fields). `LOSS` is `[1, 0, 0]`; the helper `roll(...values)` cycles, so `roll(1, 0, 0, 999_999_999)` is a lost round whose jackpot draw is 999,999,999.

  | Test | Given | Expect |
  |---|---|---|
  | `shows the jackpot with the cap set, before any round has fed it` | fresh | `GET /slots` body `jackpot` is `{ live: true, pot: 0, cap: 50_000, floor: 5_000, last: null }` |
  | `shows a pot of odd Bronze as nothing, under the cap set now` | `slots.potRow = { pot: 284, cap: null }`, `settingsRow.jackpot.cap = 80` | `pot: 0, cap: 80_000, floor: 8_000` |
  | `a lost round adds its share and draws for the jackpot` | `roll(1, 0, 0, 999_999_999)`, stake 50 | draws `[32, 32, 32, 1_000_000_000]`; `slots.betCalls[0]` matches `{ add: 2784, cap: 50, roll: 999_999_999 }`; `spin.jackpot` 0; `state.jackpot.pot` 2 |
  | `a round that pays adds nothing and draws nothing more` | `roll(...TINCTURES)` | draws `[32, 32, 32]`; bet call `add: 0` |
  | `the round that drops the pot is paid it` | `slots.potRow = { pot: 49_999_500, cap: 50_000_000 }`, lost round | `spin` matches `{ payout: 0, jackpot: 50_002 }`; `wallet` `{ gold: 55, silver: 202, copper: 0 }`; `state.jackpot` matches `{ pot: 0, last: { character: 'Mounara', amount: 50_002 } }`; `state.bigWins[0].jackpot` 50_002 |
  | `adds nothing while the jackpot is off, and keeps the pot and its cap` | `settingsRow.jackpot.live = false`, `potRow = { pot: 7_000_000, cap: 50_000_000 }`, lost round; then on again and another lost round | first bet call `add: 0`, draws `[32, 32, 32]`, `potRow` unchanged, `state.jackpot.live` false; after the second, pot 7_002_784 and cap 50_000_000 |
  | `opens without a jackpot when its table cannot be read, and refuses a lost round` | `slots.potMissing = true` | `GET /slots` 200 with `jackpot: null`; lost round 503 `Slots are not available right now`; wallet untouched |
  | `a refused spin never reaches the money step` | existing cases | unchanged, and `potRow` stays `{ pot: 0, cap: null }` |
  | `GM: shows the jackpot` | one drop planted | `GET /gm/slots` `jackpot` has `live`, `setCap: 50`, `running`, `added`, `paid`, `drops: 1`, one win; machine totals have `added` |
  | `GM: saves the switch and the cap, and logs it` | `PUT /gm/slots/jackpot { live: false, cap: 80 }` | 200, `jackpot.live` false, `setCap` 80; audit `{ command: 'SLOTS', log: 'JACKPOT off cap 80' }` |
  | `GM: a changed cap shows beside the running pot's own` | `potRow = { pot: 10_000_000, cap: 50_000_000 }`, save cap 80 | `running.cap` 50_000, `setCap` 80 |
  | `GM: refuses a cap of 0, 10001 and 1.5` | each | 400, nothing saved |
  | `GM: a non-GM cannot save the jackpot` | player | 403 |
  | `the spin throttle counts by account` | 30 spins at stake 10 as `newuser`, then one more; then one as `moose` with a character seeded for that account | the 31st is 429 `Too many attempts. Please try again later.`; moose's is 200 |

- [ ] **Step 2: Run and see them fail.** `npm run build -w packages/shared` after the type change, then `npm test -w apps/api -- test/slots.http.test.ts --maxWorkers=2`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the shared types, the guard, the service and the controller.
- [ ] **Step 4: Run** the HTTP file, then `npm run lint -w apps/api` and `npm run lint -w apps/web` (fix the fixtures it names), then `npm test -w apps/web -- src/routes/slots.test.tsx src/routes/gm-slots.test.tsx --maxWorkers=2`. Expected: all PASS.
- [ ] **Step 5: Commit.** `feat: the slots API feeds, pays and shows the jackpot, and counts spins by account`.

---

### Task 5: The player page

**Files:**
- Create: `apps/web/src/components/slots/JackpotBanner.tsx`
- Modify: `apps/web/src/routes/_authed/slots.tsx`, `apps/web/src/lib/slots.ts`, `apps/web/src/routes/slots.test.tsx`, `apps/web/src/lib/slots.test.ts` if it pins the poll

**Interfaces — Consumes:** `SlotsState.jackpot`, `SlotSpinView.jackpot` (Task 4); `slotJackpotShare` (Task 1); `useHeldSpin` as it is (the jackpot is part of the held state, so it already holds still during a spin).

**Interfaces — Produces:** `JackpotBanner({ jackpot, won }: { jackpot: SlotJackpot; won: boolean })`.

The banner sits between the gambling sentence's place and the machine tabs, above the `Tabs`. It is a `<section aria-label="Jackpot">` with:
- the label `Jackpot` and the pot as `silverText(jackpot.pot)`;
- `Must be won before ${silverText(jackpot.cap)}`, or `The jackpot is paused.` when `live` is false;
- a bar: `role="progressbar"`, `aria-label="Jackpot"`, `aria-valuemin` 0, `aria-valuemax` the cap, `aria-valuenow` the pot but never more than the cap;
- hidden below `sm`, so Spin stays on a phone's first screen: `Every lost round adds to it, on any machine. It can drop from ${silverText(jackpot.floor)}.` and, when there is one, `Last won by ${last.character}: ${silverText(last.amount)}.`;
- `data-won="true"` while `won`, which is the only hook the brief celebration (a CSS animation, off with reduced motion) and the test use.

`won` is true while the spin on show won the jackpot (`shown.spin.jackpot > 0` and the page is not busy). No banner when `view.jackpot` is null.

Page copy:
- Result line for a jackpot round, styled as a win: `Jackpot. This round made it drop. You won ${silverText(spin.jackpot)} on a stake of ${silverText(spin.stake)}.` A lost round's line stays as it is.
- Under the house line, only when the jackpot is there and on: `A lost round on this machine adds ${share}% of its stake to the jackpot. With the jackpot, the slots pay back everything staked, over time.` with `share` as `(num / den * 100).toFixed(1)` (5.6, 5.2 and 4.3).
- Your last spins, a jackpot round: `...staked 50 Silver, won the jackpot, 50 Gold 2 Silver`.
- Big wins, a jackpot round: `Mounara won the jackpot, 50 Gold 2 Silver`.
- `slotsQueryOptions.refetchInterval` becomes `15_000` (update its comment: it also keeps the pot up with other players).

- [ ] **Step 1: Write the failing tests** in `slots.test.tsx`. Fixture: `const pot: SlotJackpot = { live: true, pot: 31_420, cap: 50_000, floor: 5_000, last: { character: 'Moosey', amount: 27_310, at: '2026-11-12T09:00:00.000Z' } }`. A drop is `result(spinOf({ stops: [12, 8, 12], payout: 0, jackpot: 50_002 }), { gold: 55, silver: 202, copper: 0 })` whose state has `jackpot: { ...pot, pot: 0, last: { character: 'Mounara', amount: 50_002, at: ... } }`.

  | Test | Expect |
  |---|---|
  | `shows the jackpot above the machines` | the Jackpot region holds `31 Gold 420 Silver`, `Must be won before 50 Gold`, `It can drop from 5 Gold.`, `Last won by Moosey: 27 Gold 310 Silver.`; the bar has `aria-valuenow` 31420 and `aria-valuemax` 50000 |
  | `has no banner when the jackpot cannot be read` | `jackpot: null`: no Jackpot region, and no jackpot sentence under the pay table |
  | `says the jackpot is paused` | `live: false`: `The jackpot is paused.`, no `Must be won before`, no jackpot sentence under the pay table |
  | `shows an unfed pot as 0 Silver under the cap set` | `{ ...pot, pot: 0, last: null }`: `0 Silver`, `Must be won before 50 Gold`, no `Last won by` |
  | `never shows the bar past full` | `pot: 60_000`: `aria-valuenow` 50000 |
  | `follows a pot someone else won between two polls` | the state changes to `pot: 0` with a new `last`, then `poll()`: the figure and `Last won by` follow, and Spin still works |
  | `holds the pot still until the last reel stops, on a lost round` | the answer's state has `pot: 31_423`: the banner reads `31 Gold 420 Silver` while busy, and `31 Gold 423 Silver` after the reels stop |
  | `tells a jackpot only when the last reel stops` | while busy: pot still `31 Gold 420 Silver`, wallet without the jackpot, `data-won` not set. After: status `Jackpot. This round made it drop. You won 50 Gold 2 Silver on a stake of 50 Silver.`, wallet 55 Gold 202 Silver, banner `0 Silver` with `data-won="true"` and `Last won by Mounara: 50 Gold 2 Silver.` |
  | `lists a jackpot round in the last spins and the big wins` | `won the jackpot, 50 Gold 2 Silver` in the first; `Mounara won the jackpot, 50 Gold 2 Silver` in the second |
  | `says what a lost round adds, per machine` | Tranus's Shelf `5.6%`, The Armoury `5.2%`, Dragon's Hoard `4.3%`, each followed by `With the jackpot, the slots pay back everything staked, over time.` |
  | `reads the state every 15 seconds` | `slotsQueryOptions.refetchInterval` is 15000 |

- [ ] **Step 2: Run and see them fail.** `npm test -w apps/web -- src/routes/slots.test.tsx --maxWorkers=2`.
- [ ] **Step 3: Implement** the banner and the page changes. Keep the phone layout rule in `slots.tsx`: on a 360 px wide screen the banner is the label, the pot, the cap line and the bar only.
- [ ] **Step 4: Run** the file and `npm run lint -w apps/web`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: the slots page shows the jackpot, holds it still during a spin and tells the round that wins it`.

---

### Task 6: The GM page

**Files:**
- Modify: `apps/web/src/routes/_authed/gm/slots.tsx`, `apps/web/src/lib/slots.ts`, `apps/web/src/routes/gm-slots.test.tsx`

**Interfaces — Consumes:** `GmSlots.jackpot`, `SlotTotals.added`, `SlotSpinView.jackpot`, `PUT /gm/slots/jackpot` (Task 4); `slotJackpotSettingsSchema`, `SLOT_JACKPOT_MIN_CAP`, `SLOT_JACKPOT_MAX_CAP` (Task 1).

**Interfaces — Produces:** `useSaveSlots` accepts `{ kind: 'jackpot'; settings: SlotJackpotSettingsInput }`.

A `<section>` headed `Jackpot`, between the Status section and the first machine:
- Switch `Jackpot on`. Beside it, on: `Lost rounds add to the pot.` Off: `The pot is kept. Lost rounds add nothing and it cannot drop.` Toggling sends the saved cap, never what is typed.
- A form `Jackpot cap`: one number field `Cap for the next jackpot, in Gold`; under it, while what is typed is a whole number from 1 to 10,000, `Can drop from ${silverText(cap * 100)}, must drop before ${silverText(cap * 1000)}.`; button `Save cap`. Field errors: `Enter a whole number`, `From 1 to 10,000 Gold`. Saving sends the saved switch.
- `Pot now` with `silverText(running.pot)`, and beside it `Must drop before ${silverText(running.cap)}.`, or, when `running.cap !== setCap * 1000`, `This jackpot must drop before ${silverText(running.cap)}. The next one: ${silverText(setCap * 1000)}.`
- When `running` is null: `The jackpot's table is not in this database yet.`
- All time: `Added`, `Paid out`, `Drops`.
- A table `Jackpot drops` (When, Character, Machine, Won); empty: `Nobody has won the jackpot yet.`

Elsewhere on the page: each machine's totals gain `To the jackpot` (`silverText(totals.added)`), and `House result` becomes staked less paid less added. In `Latest spins`, the Paid cell of a jackpot round reads `Jackpot ${silverText(spin.jackpot)}`.

- [ ] **Step 1: Write the failing tests** in `gm-slots.test.tsx`: the section shows the switch, the saved cap, the pot and the totals; toggling sends `{ live: false, cap: 50 }` to `PUT /gm/slots/jackpot`; saving 80 sends `{ live: true, cap: 80 }`; `0`, `10001` and `abc` send nothing and show their error; the hint follows what is typed (`80` gives `Can drop from 8 Gold, must drop before 80 Gold.`); a running cap of 50,000 with `setCap: 80` shows `This jackpot must drop before 50 Gold. The next one: 80 Gold.`; `running: null` shows the table sentence and the switch and cap still work; the drops table and its empty line; a machine's totals show `To the jackpot`, and a house result of staked 1000, paid 900, added 40 reads `60 Silver`; a jackpot round in Latest spins reads `Jackpot 50 Gold 2 Silver`; a failed save shows its reason.
- [ ] **Step 2: Run and see them fail.** `npm test -w apps/web -- src/routes/gm-slots.test.tsx --maxWorkers=2`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `npm run lint -w apps/web`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: GMs switch the slots jackpot, set its cap and see the pot and its drops`.

---

### Task 7: The rollout script, the ledger, and the whole suite

**Files:**
- Create, outside the repo: `C:\Users\stath\Documents\4Story\4s\db_changes\2026-11-15-portal-slots-jackpot\apply.sql` and `undo.sql`, laid out like `db_changes\2026-11-14-portal-slots`
- Modify, outside the repo: `C:\Users\stath\Documents\4Story\4s\GAME_CHANGES_LEDGER.md` (a new entry at the top, using the file's template)

- [ ] **Step 1: Write `apply.sql`** from the two scripts in `apps/api/sql/` (the pot table with its row, the two spin columns), against `TGAME_GSP`, safe to run twice. It needs the slots script (`2026-11-14-portal-slots`) applied first, and says so at the top.
- [ ] **Step 2: Write `undo.sql`**: drop `TPORTALSLOTJACKPOT`, the two default constraints and the two columns, and delete the `slots_jackpot_live` and `slots_jackpot_cap` setting rows. Its head comment says: a pot that has not been won is lost with the table, so let it drop first or accept that; and the API from before this change must be running again before the undo, because the new one writes the two columns.
- [ ] **Step 3: Add the ledger entry**, status "written, not applied": what it adds, that no game server restart is needed, that the SQL goes in before the new API spins against that database, and the undo steps. Do not run either script.
- [ ] **Step 4: Run everything this change touches.** `npm run build -w packages/shared`; `npm test -w packages/shared -- --maxWorkers=2`; `npm test -w apps/api -- --maxWorkers=2`; the DB run for `test/db/slots.db.test.ts` and `test/db/roulette.db.test.ts` with the two `_TEST` names; `npm test -w apps/web -- --maxWorkers=2`; `npm run lint`. Expected: all PASS. Report the counts as printed.
- [ ] **Step 5: Commit** anything the run made you fix: `test: ...` or `fix: ...` as it applies. The two files outside the repo are not committed.
