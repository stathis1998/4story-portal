# Rebirth Extras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each rebirth also raises EXP gained and monster gold received by a GM-set percentage, and can pay a GM-set reward (money and up to three items) by in-game letter.

**Architecture:** The portal works out each character's EXP and gold bonus from the settings and stores them beside the stat bonus in `TCHARREBIRTHTABLE`; the map server reads them at character load and applies them in `GainExp` and wherever monster gold is paid. Rewards live in a new table keyed by rebirth number, and the existing rebirth batch sends the letter through `TPortalGmPost` inside its own transaction.

**Tech Stack:** NestJS + mssql + zod (API), React 19 + TanStack Router/Query + Tailwind (web), vitest, SQL Server, C++ (TMapSvr, `Server\TServer.sln`).

**Spec:** `docs/superpowers/specs/2026-11-16-rebirth-extras-design.md`. Read it first, and the plan it extends, `docs/superpowers/plans/2026-11-15-rebirth.md`, whose code this changes. Closest patterns: achievement rewards (`apps/api/src/achievements/`, `TPORTALACHIEVEMENTREWARD.sql`, `TPortalAchievementAward.sql`, `apps/web/src/routes/_authed/gm/achievements.tsx`), the wheel's reuse of `RewardEditor` (`apps/web/src/routes/_authed/gm/wheel.tsx`), and the stat bonus server commit `ee7797a` in the Server repo.

## Global Constraints

- **Never edit `.env`.** It names this machine's game databases. DB tests run with `DB_GLOBAL_NAME=TGLOBAL_GSP_TEST DB_GAME_NAME=TGAME_GSP_TEST` set in the shell. A worktree has no `.env`: load the main one into the shell, then set those two names.
- **SQL runs only against `TGAME_GSP_TEST` / `TGLOBAL_GSP_TEST`** until Task 7 says to ask the owner. DB tests roll back.
- **No dev servers, no browsers, no `nest build`.** Vitest only, affected files only, `--maxWorkers=2`, from a path spelled with a capital `C:`.
- **Portal work** in worktree `.worktrees/rebirth-extras` on branch `feat/rebirth-extras` (not `.worktrees/rebirth`: a leftover folder of that name can't be deleted). Copy this plan into it and commit it as `docs:` first; the spec is already on `main`.
- After changing `packages/shared`, run `npm run build -w packages/shared` before API or web tests.
- **Server work** in `C:\Users\stath\Documents\4Story\4s\4Story_5.0_Source - kopie\Server` on branch `feature/rebirth-extras` from `master`. Never build any project of `TServer.sln` and never touch `Server\Services\`: the owner stops the servers and rebuilds, or asks Claude to. Most `.cpp`/`.h` files are not UTF-8: edit them with a script that round-trips Latin-1, never with a tool that re-encodes.
- Numbers from the spec: EXP and gold percent per rebirth each an integer **0 to 25**, **0 = off**, default **0**; `expPercent × limit ≤ 250` and `goldPercent × limit ≤ 250`; each bonus is `min(rebirths, limit) × percent`, like the stat bonus; rewards exist for rebirth **1 to 20**; one letter, at most **3** items; sender **`Rebirth`**, title **`Rebirth N reward`**.
- Money math in the server is 64-bit, capped at `0xFFFFFFFF`.
- Bow of War and Battle Royale (`BOW_COMPILE_MODE`, `BR_COMPILE_MODE`) ignore both bonuses.
- Coins are called Gold, Silver and Bronze in anything a person reads; code keeps `copper` / `dwCooper`. UI copy: plain ASCII punctuation, sentence case, no exclamation marks.
- Commits: `feat:` / `test:` / `docs:` prefix, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A GM lowers the limit after rewards were set above it:** those rewards stay saved, show as "beyond the limit" and are never sent; raising the limit again makes them reachable. (Tasks 3 and 5)
2. **Settings rows for EXP and gold are missing (a database from before this change):** rebirth still works, both bonuses read 0 and rebirth stays open if it was. (Tasks 3)
3. **A reward pays money only, or items only:** one letter with exactly that; a reward saved with nothing deletes the row and sends no letter. (Task 3)
4. **One EXP gain carries a character over its level cap:** only the part used for levels is boosted; the part turned into gold is the base amount. (Task 6; the server has no test harness, so Task 6 Step 2 checks this by reading the diff, and the ledger lists it for the owner's in-game check)
5. **A party member on another channel loots with a reborn looter:** each player gets their own gold bonus, not the looter's. (Task 6, checked the same way)

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/rebirth.ts` | Settings fields and limits, bonus helper, reward request schema, view types |
| `apps/api/sql/TCHARREBIRTHTABLE.sql`, `TCHARREBIRTHLOGTABLE.sql`, new `TPORTALREBIRTHREWARD.sql` | Tables and the new columns |
| `apps/api/src/rebirth/rebirth-sql.ts` | The batch: two more bonuses and the reward letter |
| `apps/api/src/rebirth/rebirth.repository.ts` | Settings with two more keys, rewards read/write, item lookup |
| `apps/api/src/gm/reward-items.ts` (new) | The item checks a mailed reward needs, shared by achievements, wheel and rebirth |
| `apps/api/src/rebirth/rebirth.service.ts`, `rebirth.controller.ts` | State with the new bonuses and next reward, GM reward route, audit |
| `apps/web/src/routes/_authed/gm/rebirth.tsx` | Two settings fields and the rewards list |
| `apps/web/src/components/stats/RebirthSection.tsx` | The bonuses and the next reward on the character page |
| `Server/TMapSvr/DBAccess.h`, `TCharStat.cpp`, `TPlayer.h`, `TPlayer.cpp`, `TMapSvr.cpp`, `SSHandler.cpp` | Read, carry and apply the two bonuses |
| `Server/db_changes/2026-11-16-rebirth-extras/apply.sql`, `undo.sql` | The script for the game databases |

---

### Task 1: Shared rules

**Files:**
- Modify: `packages/shared/src/rebirth.ts`
- Test: `packages/shared/src/rebirth.test.ts`

**Interfaces:**
- Consumes: `achievementRewardSchema`, `AchievementReward`, `AchievementRewardInput` from `packages/shared/src/achievements.ts`.
- Produces:

```ts
export type RebirthSettings = { live: boolean; priceGold: number; percent: number; limit: number; expPercent: number; goldPercent: number };
// REBIRTH_DEFAULT_SETTINGS gains expPercent: 0, goldPercent: 0
export const REBIRTH_MAX_EXTRA_PERCENT = 25;
export const REBIRTH_MAX_EXTRA_TOTAL = 250;
export const REBIRTH_MAX_NUMBER = 20; // the highest rebirth a reward can be set for (the highest limit)
/** min(rebirths, limit) × the given percent. rebirthBonus keeps its signature and calls this with s.percent. */
export const rebirthExtraBonus = (rebirths: number, limit: number, percent: number): number;
export const rebirthRewardNumberSchema: z.ZodType<number>; // integer 1..REBIRTH_MAX_NUMBER, coerced from a path string
export const rebirthRewardSchema = achievementRewardSchema;
export type RebirthBonuses = { stats: number; exp: number; gold: number };
// RebirthState: `bonus: number` becomes `bonuses: RebirthBonuses`;
//   next becomes { number: number; bonuses: RebirthBonuses; priceGold: number; reward: AchievementReward | null } | null
export type GmRebirthReward = { rebirth: number; reward: AchievementReward };
// GmRebirth gains rewards: GmRebirthReward[] (every saved reward, by rebirth number, including ones above the limit)
```

- [ ] **Step 1: Write the failing tests** in `rebirth.test.ts`:

```ts
it('accepts EXP and gold percents from 0 to 25', ...)            // 0 and 25 parse; 26 and -1 fail on that field
it('refuses an EXP or gold total over 250', ...)                  // expPercent 13, limit 20 fails on expPercent; 12 x 20 passes; same for goldPercent
it('works out an extra bonus up to the limit', ...)              // rebirthExtraBonus(3, 10, 10) === 30; (15, 10, 10) === 100; (2, 10, 0) === 0
it('defaults both extras to 0', ...)                              // REBIRTH_DEFAULT_SETTINGS.expPercent === 0 && goldPercent === 0
it('reads a reward number from 1 to 20', ...)                     // '1' -> 1, '20' -> 20; '0', '21', '1.5', 'x' fail
```

- [ ] **Step 2: Run** `npx vitest run src/rebirth.test.ts` in `packages/shared`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above in `rebirth.ts`; the two new settings refinements sit beside the existing `percent × limit` one with messages `EXP times limit cannot pass 250` / `Gold times limit cannot pass 250`.
- [ ] **Step 4: Run** the shared tests, then `npm run build -w packages/shared`. Expected: PASS, build clean. API and web will not type-check until Tasks 3 to 5; that is expected.
- [ ] **Step 5: Commit** `feat: rebirth settings for EXP and gold, and reward types`.

---

### Task 2: Tables and the database script

**Files:**
- Modify: `apps/api/sql/TCHARREBIRTHTABLE.sql`, `apps/api/sql/TCHARREBIRTHLOGTABLE.sql`, `apps/api/src/db/db.service.ts`, `apps/api/test/table-names.test.ts`
- Create: `apps/api/sql/TPORTALREBIRTHREWARD.sql`; in the Server repo `db_changes/2026-11-16-rebirth-extras/apply.sql` and `undo.sql`

**Interfaces:**
- Produces: `tableNames` gains `rebirthRewards: ${game}.TPORTALREBIRTHREWARD`. Columns:

```sql
TCHARREBIRTHTABLE      + bExpBonus TINYINT NOT NULL DEFAULT 0 CHECK (bExpBonus <= 250),
                         bGoldBonus TINYINT NOT NULL DEFAULT 0 CHECK (bGoldBonus <= 250)
TCHARREBIRTHLOGTABLE   + dwPostID INT NOT NULL DEFAULT 0          -- the reward letter, 0 for none
TPORTALREBIRTHREWARD   bRebirth TINYINT PRIMARY KEY CHECK (bRebirth BETWEEN 1 AND 20), then exactly the money,
                       item, count, szUpdatedBy and dUpdated columns of TPORTALACHIEVEMENTREWARD
```

- [ ] **Step 1: Write the SQL.** The two existing portal files keep their `CREATE TABLE` (now with the new columns) and add an `IF COL_LENGTH(...) IS NULL ALTER TABLE ... ADD` per column, so running either file on a database that already has the table brings it up to date. Name every constraint (`DF_`/`CK_` + table + column) so `undo.sql` can drop them. `apply.sql` follows `2026-11-15-rebirth/apply.sql`: `:on error exit`, only `TGAME_GSP` or `TGAME_GSP_TEST`, refuses unless `TCHARREBIRTHTABLE` exists (rebirth must be applied first), adds the columns and the table, one transaction, and is safe to run twice. `undo.sql` drops the reward table, the three columns and their constraints, and deletes the `rebirth_exp_percent` and `rebirth_gold_percent` setting rows. `TPORTALREBIRTHREWARD` is not added to the season reset list (kept, like achievement rewards); say so in its header comment.
- [ ] **Step 2: Apply to the test copy only:** `sqlcmd -S "localhost\FOURSTORY" -E -C -b -d TGAME_GSP_TEST -i <Server>\db_changes\2026-11-16-rebirth-extras\apply.sql`, then run it a second time. Expected: exit 0 both times. Then run `undo.sql` and `apply.sql` again. Expected: exit 0.
- [ ] **Step 3: Add the table name** and update `table-names.test.ts`; run it. Expected: PASS.
- [ ] **Step 4: Commit** in the portal `feat: tables for rebirth EXP and gold bonuses and rewards`; in the Server repo, add a line to `db_changes/README.md` (apply after `2026-11-15-rebirth`, before the portal from this branch and before a TMapSvr built from `feature/rebirth-extras`) and commit `chore: rebirth extras database scripts`.

---

### Task 3: Repository and batch

**Files:**
- Modify: `apps/api/src/rebirth/rebirth-sql.ts`, `apps/api/src/rebirth/rebirth.repository.ts`, `apps/api/test/fakes.ts` (`FakeRebirthRepository`)
- Test: `apps/api/test/db/rebirth.db.test.ts`

**Interfaces:**
- Consumes: Task 1's `RebirthSettings`, Task 2's tables, `db.tables.mailProcedure`.
- Produces:

```ts
// rebirth-sql.ts
REBIRTH_KEYS gains expPercent: 'rebirth_exp_percent', goldPercent: 'rebirth_gold_percent'
export const REWARD_SENDER = 'Rebirth';
// The result row gains expBonus, goldBonus, postId.

// rebirth.repository.ts
export type RebirthRewardRow = { rebirth: number; gold: number; silver: number; copper: number; items: { itemId: number; count: number }[] };
RebirthCharacterRow: `bonus` becomes `statBonus`, plus expBonus: number, goldBonus: number
RebirthOutcome (OK): `bonus` becomes `bonuses: RebirthBonuses`, plus postId: number
interface RebirthRepository {
  rewards(): Promise<RebirthRewardRow[]>;                               // every row, by rebirth number
  setReward(reward: RebirthRewardRow, changedBy: string): Promise<void>; // an empty reward deletes the row
  findItems(itemIds: number[]): Promise<{ itemId: number; name: string; stack: number }[]>; // same query as AchievementsRepository.findItems
}
```

**The batch changes**, all inside the existing transaction:

1. Settings: read the two new keys too. A missing row reads 0. A row that is present but not an integer from 0 to 25, or whose value times the limit passes 250, makes the batch return `REBIRTH_CLOSED`, as the stat percent does today.
2. `rebirths` upsert writes `bExpBonus` and `bGoldBonus` = min(count, limit) × each percent, beside `bStatBonus`.
3. After the log row is written: read `rebirthRewards` for the new count. When it pays anything (money above 0 or any item), `EXEC @post = <mailProcedure>` with sender `REWARD_SENDER`, title `Rebirth N reward`, message `You were reborn. Your reward for rebirth N is attached.`, the money and the three item/count pairs (0 for empty). `IF @post = 0 THROW 50001, 'Rebirth reward letter not sent', 1;`. Update the log row's `dwPostID` with `@post`.
4. The result row returns `expBonus`, `goldBonus` and `postId` (0 without a letter).

`settings()` returns `expPercent` and `goldPercent` as 0 when their rows are missing (the four existing rows still decide the fallback to defaults). `saveSettings()` writes the two new rows and its recalculating `UPDATE` sets all three bonus columns.

- [ ] **Step 1: Write the failing DB tests**, extending `rebirth.db.test.ts` (its `ready`/`go` helpers; `ready` also deletes `TPORTALREBIRTHREWARD` rows and writes `rebirth_exp_percent 10`, `rebirth_gold_percent 5`; add `TPORTALREBIRTHREWARD.sql` to `setupSql`):

```ts
it('stores the EXP and gold bonuses with the stat bonus', ...)        // rebirth 1 -> TCHARREBIRTHTABLE (1, 2, 10, 5); outcome.bonuses { stats: 2, exp: 10, gold: 5 }
it('reads missing EXP and gold settings as 0', ...)                   // both rows deleted -> OK, bonuses exp 0, gold 0
it('refuses with closed when an EXP setting is unreadable', ...)      // 'x', '26', and 13 with limit 20 -> REBIRTH_CLOSED, nothing written
it('mails the reward for that rebirth number', ...)
  // reward for rebirth 1: 2 Gold, item A x3, item B x1 -> one TPOSTTABLE row for the character, szSender 'Rebirth',
  // dwGold 2, two TITEMTABLE rows with bStorageType 2 and dwStorageID = the post; log dwPostID = that post; outcome.postId the same
it('mails money only, or items only', ...)                            // two cases, each one letter with exactly that
it('sends nothing for a rebirth number without a reward', ...)        // reward saved for rebirth 2 only -> rebirth 1: no TPOSTTABLE row from 'Rebirth', dwPostID 0
it('sends the reward of the second rebirth on the second rebirth', ...)
it('never sends a reward saved above the limit', ...)                 // limit 1, reward for rebirth 2, character at 1 -> REBIRTH_AT_LIMIT, no letter
it('keeps a reward above a lowered limit', ...)                       // setReward(rebirth 5), saveSettings(limit 3) -> rewards() still has rebirth 5
it('deletes a reward saved empty', ...)
it('recalculates every bonus when the settings are saved', ...)       // a row with count 3; save exp 10, gold 4, limit 2 -> (.., 20, 8)
it('finds the character with all three bonuses', ...)                 // find(): statBonus, expBonus, goldBonus
```

- [ ] **Step 2: Run** `npx vitest run --config vitest.db.config.ts test/db/rebirth.db.test.ts --maxWorkers=2` in `apps/api` with the `_TEST` names. Expected: FAIL.
- [ ] **Step 3: Implement** the batch and repository changes, and update `FakeRebirthRepository` to the new interface (in-memory rewards, `findItems` returning what the test seeds).
- [ ] **Step 4: Run** the DB tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the rebirth batch stores EXP and gold bonuses and mails the reward`.

---

### Task 4: Service, routes and the shared reward checks

**Files:**
- Create: `apps/api/src/gm/reward-items.ts`
- Modify: `apps/api/src/achievements/achievements.service.ts`, `apps/api/src/wheel/wheel.service.ts`, `apps/api/src/rebirth/rebirth.service.ts`, `apps/api/src/rebirth/rebirth.controller.ts`
- Test: `apps/api/test/rebirth.http.test.ts`, existing `achievements.http.test.ts` and `wheel.http.test.ts` (must stay green unchanged)

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces:

```ts
// reward-items.ts: the body both services' private checkItems have today, moved here unchanged (unknown items, not in the client, stack)
export async function checkRewardItems(
  items: { itemId: number; count: number }[],
  findItems: (ids: number[]) => Promise<{ itemId: number; name: string; stack: number }[]>,
): Promise<void>;
// RebirthService
setReward(rebirth: number, reward: AchievementRewardInput, actor: Actor): Promise<GmRebirth>;
// Controller
PUT gm/rebirth/rewards/:rebirth   GmGuard + ThrottlerGuard (30 a minute), body rebirthRewardSchema, param rebirthRewardNumberSchema -> GmRebirth
```

`state()` fills `bonuses` from the row and `next.bonuses` with `rebirthBonus` / `rebirthExtraBonus`, and `next.reward` from the saved reward for `next.number` (with item names and icons, built like `wheel.service.ts` `rewardView`), null when none. `gmState()` adds `rewards`. Reading rewards falls back to empty when the table can't be read, as achievements do. `saveSettings` audits `SET ... exp X gold Y` appended to today's line; `setReward` audits `REWARD N gold G silver S copper C items id x count, ...`.

- [ ] **Step 1: Write the failing HTTP tests** in `rebirth.http.test.ts`:

```ts
it('shows all three bonuses now and after the next rebirth', ...)        // fake: rebirths 1, settings percent 5 exp 10 gold 5 -> bonuses {5,10,5}, next.bonuses {10,20,10}
it('shows the next rebirth\'s reward with item names', ...)              // reward for rebirth 2 -> next.reward.items[0].name
it('shows no reward when the next rebirth has none', ...)                // next.reward === null
it('saves a reward for a GM', ...)                                       // PUT gm/rebirth/rewards/3 -> 200, body.rewards has rebirth 3
it('refuses a reward for a player', ...)                                 // 403
it.each([['0'], ['21'], ['x']])('refuses reward number %s', ...)         // 400
it('refuses an unknown item, an item missing from the client and a count over its stack', ...) // 422 with the same messages as achievements
it('refuses four items', ...)                                            // 400
it('saves EXP and gold settings', ...)                                   // PUT settings with expPercent 10, goldPercent 5 -> 200, echoed
it('refuses an EXP total over 250', ...)                                 // expPercent 13, limit 20 -> 400
```

- [ ] **Step 2: Run** `npx vitest run test/rebirth.http.test.ts --maxWorkers=2` in `apps/api`. Expected: FAIL.
- [ ] **Step 3: Implement**: move the item checks into `reward-items.ts` and call it from all three services; add the service and controller changes.
- [ ] **Step 4: Run** `rebirth.http.test.ts`, `achievements.http.test.ts`, `wheel.http.test.ts`, then `npx tsc --noEmit -p .` in `apps/api`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat: GM rebirth rewards and the new bonuses in the rebirth state`.

---

### Task 5: The pages

**Files:**
- Modify: `apps/web/src/lib/rebirth.ts`, `apps/web/src/routes/_authed/gm/rebirth.tsx`, `apps/web/src/components/stats/RebirthSection.tsx`
- Test: `apps/web/src/routes/gm-rebirth.test.tsx`, `apps/web/src/routes/rebirth.test.tsx`

**Interfaces:**
- Consumes: Task 1's types, Task 4's route, `RewardEditor` (`name`, `reward`, `saving`, `error`, `onSave`, `onCancel`, `emptyNote`), the reward wording component the achievements page uses (`components/stats/RewardSummary.tsx`).
- Produces: `saveRebirthReward(rebirth: number, reward: AchievementRewardInput): Promise<GmRebirth>` in `lib/rebirth.ts`.

`RebirthState.bonus` is now `bonuses`: update `RebirthSection.tsx` (today's `Bonus:` and `Next:` lines). The log table's `entry.bonus` on the GM page is the log row's stat bonus and stays. The GM page follows the spec's sketch: two number fields labelled `EXP per rebirth` and `Monster gold per rebirth` with the hint `0 = off`, then a `Rewards` list with one row per rebirth from 1 to the saved limit (`Rebirth N`, the reward's summary or `Nothing`, an `Edit` button opening `RewardEditor` with `emptyNote` `Saving with nothing removes this reward`), then any saved rewards above the limit under the heading `Beyond the limit`. The character page's rebirth section shows `Stats +X%`, `EXP +Y%`, `Monster gold +Z%` (an extra at 0 is left out), the next rebirth's bonuses, and `Reward:` with the summary when `next.reward` is set; the confirmation lists the reward under what the character gets.

- [ ] **Step 1: Write the failing tests:**

```ts
// gm-rebirth.test.tsx
it('saves EXP and gold percents with the other settings', ...)       // typed 10 and 5 -> request body has expPercent 10, goldPercent 5
it('lists a row for every rebirth up to the limit', ...)             // limit 3 -> Rebirth 1, Rebirth 2, Rebirth 3
it('opens the reward editor and saves a reward', ...)                // Edit on Rebirth 2 -> PUT gm/rebirth/rewards/2
it('shows rewards above the limit under Beyond the limit', ...)      // limit 2, saved reward for 5
// rebirth.test.tsx
it('shows the three bonuses and leaves out an extra at 0', ...)      // bonuses {4, 10, 0} -> Stats +4%, EXP +10%, no Monster gold
it('shows the next reward and lists it in the confirmation', ...)
it('shows no reward line when the next rebirth has none', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/routes/gm-rebirth.test.tsx src/routes/rebirth.test.tsx --maxWorkers=2` in `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement** the page changes.
- [ ] **Step 4: Run** those two files, then `npx tsc --noEmit -p .` and `npm run lint` in `apps/web`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat: rebirth EXP, gold and rewards on the GM page and the character page`.

---

### Task 6: The map server applies the EXP and gold bonuses

**Files (Server repo, branch `feature/rebirth-extras`):**
- Modify: `TMapSvr/DBAccess.h` (`CTBLCharRebirth`), `TMapSvr/TCharStat.cpp`, `TMapSvr/TPlayer.h`, `TMapSvr/TPlayer.cpp`, `TMapSvr/TMapSvr.cpp` (`MonMoneyTake`), `TMapSvr/SSHandler.cpp` (`OnMW_TAKEMONMONEY_REQ`)

**Interfaces:**
- Consumes: Task 2's columns.
- Produces:

```cpp
// TPlayer.h, beside m_bRebirthBonus (initialised to 0 where it is)
BYTE m_bRebirthExp;
BYTE m_bRebirthGold;
/** dwExp raised by m_bRebirthExp percent, 64-bit, capped at 0xFFFFFFFF. Unchanged under BOW/BR or at 0. */
DWORD RebirthExp(DWORD dwExp);
/** dwMoney raised by m_bRebirthGold percent, 64-bit, capped at 0xFFFFFFFF. Unchanged under BOW/BR or at 0. */
DWORD RebirthGold(DWORD dwMoney);
```

- **Load and carry:** `CTBLCharRebirth` selects `bStatBonus, bExpBonus, bGoldBonus` (3 columns). `WriteCharStatFromDB` writes the two new bytes right after `bRebirthBonus` (0 and 0 when there is no row or the read fails); `WrapCharStat` / `UnwrapCharStat` carry `m_bRebirthExp` then `m_bRebirthGold` after `m_bRebirthBonus`. Update the packet layout comment at the top of `TCharStat.cpp`.
- **EXP** in `GainExp`, below the cap only: let `dwExpGain` stay the base (`dwGain + dwBonus`). The new EXP is `min(m_dwEXP + RebirthExp(dwExpGain), cap EXP)`. The gold for overflow is `max(0, m_dwEXP + dwExpGain - cap EXP)`, the base amount, never the boosted one. At or above the cap, `EarnMoney(dwExpGain)` is unchanged. The soul bar keeps using `dwGain`.
- **Gold**: in `MonMoneyTake`, every amount given to a player through `EarnMoney` and `AddCounter(CHARCOUNTER_MONMONEY, ...)` is passed through that player's `RebirthGold` first, for the looter and for each local party member; a party member on another server (`!m_bMain`) is sent the base amount through `SendMW_TAKEMONMONEY_ACK`, and `OnMW_TAKEMONMONEY_REQ` applies `RebirthGold` for that player before paying and counting. Cover the solo (`OWNER_PRIVATE`) branch as well as `OWNER_PARTY`.
- Mark each change with `// Moose - rebirth extras` like the existing changes.

- [ ] **Step 1: Make the changes** with a Latin-1 round-trip script. Check with `git diff --stat` that only the six files changed and `git diff` shows no re-encoded lines.
- [ ] **Step 2: Review the diff by reading it** against the bullets above (no build: the owner builds). Confirm the three `#if defined(BOW_COMPILE_MODE) || defined(BR_COMPILE_MODE)` guards are present, and that `WrapCharStat` and `UnwrapCharStat` handle the bytes in the same order.
- [ ] **Step 3: Commit** `feat: rebirth EXP and gold bonuses` with a body saying the database script must be applied first and that `TMapSvr`, `TBoWSvr` and `TBRSvr` must be rebuilt together.

---

### Task 7: Ledger, full run and the owner's steps

**Files:**
- Modify: `C:\Users\stath\Documents\4Story\4s\GAME_CHANGES_LEDGER.md`, `docs/superpowers/specs/2026-11-16-rebirth-extras-design.md` (status line)

- [ ] **Step 1: Full run** in the worktree: shared tests, API unit and HTTP tests, API DB tests with the `_TEST` names, web tests, and `npm run lint` in all three. Expected: all pass, lint clean.
- [ ] **Step 2: Ledger entry** dated 2026-11-16, in the form of the 2026-11-15 rebirth entry: status (test copy only, not merged, not built), what changed, restart needed (rebuild all three together), why, the live order (apply `2026-11-16-rebirth-extras/apply.sql` to `TGAME_GSP`, then merge the portal, then rebuild, then set the percents and rewards on `/gm/rebirth`), what to check in game (an EXP gain with and without the bonus, a party loot with a reborn and a plain member, a reward letter at login), and the undo.
- [ ] **Step 3: Set the spec's status line** to built on `feat/rebirth-extras` and `feature/rebirth-extras`, not applied, not built. Commit `docs: rebirth extras ledger and status`.
- [ ] **Step 4: Stop and report to the owner.** Do not apply SQL to `TGAME_GSP`, merge, push or build without the owner's go-ahead.
