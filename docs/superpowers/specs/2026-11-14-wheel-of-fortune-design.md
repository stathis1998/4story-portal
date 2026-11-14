# Wheel of Fortune: one free spin a day for a prize by mail

Date: 2026-11-14.

## Why

Players should have a reason to open the portal every day. A wheel they spin once a day for gold or
items, delivered to a character of their choice, gives them one, and it works from a phone.

## What it does

- **A page, `/wheel`, with a wheel of prizes.** Each prize is a segment: gold, items or both.
- **One free spin a day per account.** The spin comes back at midnight on the server's clock. The
  page shows a countdown until then.
- **The player picks a character first.** The prize goes to that character as an in-game letter from
  `Wheel of Fortune`, with the gold and items attached. The character must belong to the account and
  be level 20 or higher. The last choice is remembered in the browser.
- **The server decides the prize.** The browser asks to spin, the server picks by the prizes' chances,
  sends the letter and records the spin, and only then does the wheel turn and stop on that prize.
  Closing the page mid-turn changes nothing: the prize is already in the mailbox.
- **Chances are shown.** Under the wheel is the list of prizes with the chance of each, the player's
  own last 10 spins, and the last 10 announced wins by anyone.
- **Big prizes are announced in game.** A prize marked "announce" by a GM puts an Operator line in
  world chat: `Mounara won 10 Rune on the Wheel of Fortune`. It is sent about 15 seconds after the
  spin, so chat does not spoil the wheel.
- **GMs edit everything on `/gm/wheel`:** add, change, disable and delete prizes, set each one's
  name, weight, reward and whether it is announced, and switch the wheel on and off.
- **It starts switched off.** Until a GM switches it on, players see the wheel and its prizes with a
  note that it opens soon, and cannot spin.

## Prizes

A prize has a name (shown on the wheel and in the letter), a weight, and the same reward shape as an
achievement level: Rune, Luna, Cron and up to three items with counts. Its chance is its weight
divided by the total weight of the enabled prizes, so the GM page shows the resulting percentage next
to each weight. A prize with no gold and no items is allowed as a "no luck today" segment; it sends
no letter.

Segments on the wheel are all the same size, in the order the GM sets. The weight only changes how
often a segment wins, which is why the chances are listed under the wheel.

Changing prizes takes effect from the next spin. Every spin stores its own copy of what it paid, so
editing or deleting a prize never changes history.

### Initial prizes

Inserted once, when the prize table is first created. Prices are what Tranus charges today.

| Prize | Weight | Worth |
|---|---|---|
| 100 Luna | 22 | 0.1 Rune |
| 5 Apprentice Formulas (8501) | 16 | 0.05 Rune |
| 300 Luna | 15 | 0.3 Rune |
| Master's Formula (7602) | 10 | 0.1 Rune |
| 2 Serendipity 100% (7609) | 10 | 0.2 Rune |
| Survival Tincture (7654) | 8 | 0.2 Rune |
| 10 Healing Potions (7600, First-Class) | 8 | 0.5 Rune |
| 1 Rune | 6 | 1 Rune |
| Experience Potion (7714) | 4 | 5 Rune |
| 10 Rune, announced | 1 | 10 Rune |

The weights add up to 100, so each weight is its chance in percent. An account wins about 0.5 Rune
of value a day on average. All of it can be changed on the GM page before the switch goes on.

## How a spin works

1. The browser sends `POST /api/wheel/spin` with the character's ID.
2. The API reads the enabled prizes and picks one by weight, using the operating system's random
   source.
3. It calls the procedure `TPortalWheelSpin` with the account, the character and the prize. In one
   transaction the procedure checks that:
   - the wheel is switched on;
   - the account has not spun today, by the database's own date;
   - the character belongs to the account, is not deleted and is level 20 or higher;
   - the prize still exists and is enabled.
   It then sends the letter through `TPortalGmPost` (the same path GM mail and achievements use,
   including the in-game "new mail" alert) and inserts the spin row. The spin table also has a unique
   key on account and day, so two requests at the same moment cannot both win.
4. If the prize was disabled or deleted between the pick and the call, the API picks again.
5. The API answers with the prize, and the wheel turns to it.

A spin is never recorded without its letter, and never paid twice. The API refuses with a clear
message when the wheel is off, the account has already spun, or the character is not eligible.

Announcements follow the achievements pattern: the spin row is marked as waiting, a timer in the API
claims each waiting row in the database before sending it through the control server, and anything
older than 10 minutes is skipped. Two portal processes on one database cannot announce twice.

## Approaches considered

- **Chosen: the API picks, a database procedure checks, mails and records in one transaction.** No
  game server rebuild. The limit of one spin a day is enforced where the letter is written.
- *Spins and prizes in the portal's SQLite file.* The record and the letter would be in two stores,
  so a crash between them means a prize paid twice or not at all, and a second portal process (a
  worktree against live) would have its own, different prizes. The achievements work already moved
  away from this for the same reason.
- *Picking the prize inside the procedure.* Keeps everything in one place, but SQL randomness is
  awkward to test and the API has to read the prizes anyway to draw the wheel.
- *An in-game wheel NPC.* Needs client and map server work; the point here is the portal.

## Pages

**`/wheel` (players).** One column on a phone: character picker, the wheel, a large Spin button, the
result, then the lists. The wheel is an SVG that scales with the screen up to about 420 px, with a
fixed pointer on top. The turn takes about five seconds; with "reduce motion" set in the browser it
jumps straight to the result. Buttons and the picker are at least 44 px tall. Characters under level
20 are listed but cannot be chosen, with the reason. "Wheel" is added to the main menu.

**`/gm/wheel` (GMs).** The on/off switch, then a table of prizes: order, name, weight with the
resulting chance, reward, announce, enabled. Rewards are edited with the editor the achievements page
uses. Items are checked the way GM mail checks them: the item must exist in the game database and in
the client, and the count must fit its stack. Every change writes a row to the GM audit log. The page
also shows how many spins were made today.

## Where things live

| What | Where |
|---|---|
| Prizes | `TGAME_GSP.dbo.TPORTALWHEELPRIZE` |
| Spins (limit, history, announcements) | `TGAME_GSP.dbo.TPORTALWHEELSPINTABLE`, unique on account and day |
| The switch | `TGAME_GSP.dbo.TPORTALSETTING`, key `wheel_live` |
| Spin procedure | `apps/api/sql/TPortalWheelSpin.sql` |
| API | `apps/api/src/wheel/` (controller, service, repository, announcer) |
| Types shared with the web | `packages/shared/src/wheel.ts` |
| Player page, GM page | `apps/web/src/routes/_authed/wheel.tsx`, `apps/web/src/routes/_authed/gm/wheel.tsx` |

## Rolling it out

- The SQL is additive: two new tables, one procedure, ten prize rows. No game server restart.
- It is applied to `TGAME_GSP_TEST` while building. Applying it to the live database is a separate
  step that waits for the owner's go-ahead, with `apply.sql` and `undo.sql` in `db_changes` and an
  entry in the game changes ledger.
- After that the wheel is visible but off. A GM reviews the prizes and switches it on.

## Testing

- **Unit:** picking by weight (including a single prize and disabled prizes), the service's refusals,
  the announcer's claim and skip rules.
- **HTTP:** login needed; a non-GM cannot reach the GM routes; spin answers and error codes.
- **Database** (against `TGAME_GSP_TEST`, each case in a rolled-back transaction): one spin a day,
  someone else's character, a character under level 20, wheel off, prize disabled, the letter's
  contents, an empty prize sending no letter.
- **Web:** the page's states (off, ready, spun today with countdown, no eligible character), the spin
  flow, the GM table and editor.
- No browser runs on the VM, so the owner checks the look and the animation on a desktop and a phone.

## Not in this version

- Paid or extra spins, and bonus spins from events or streaks.
- Prizes with limited stock, or prizes that differ by class or level.
- A spin per character instead of per account.
- Rewards other than gold and items.
