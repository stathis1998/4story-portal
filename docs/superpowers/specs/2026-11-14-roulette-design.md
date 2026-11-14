# Roulette: bet an offline character's money on a real wheel

Date: 2026-11-14.

## Why

For fun. The portal gets a corner of mini games where players can risk their in-game money, and
roulette is the first. More games will follow, so the menu gets a group for them and the pieces that
any money game needs (picking an offline character, moving money safely, a log of every round) are
built so the next game can use them.

It is real gambling with game money, and the page says so. The wording is playful, the odds are not
hidden.

## What it does

- **A page, `/roulette`, with a European roulette wheel and its betting table.** 37 pockets, 0 to 36,
  one green zero.
- **The player picks one of their own characters that is logged out.** The stake comes out of that
  character's wallet (Gold, Silver, Bronze) and winnings go straight back into it. Characters that
  are in the game are listed but cannot be chosen, with the reason. The last choice is remembered in
  the browser.
- **The player puts chips on the table,** on as many spots as they like, then presses Spin.
- **The server decides where the ball lands** and moves the money in one step. Only then does the
  wheel turn and the ball settle on that pocket. Closing the page mid-spin changes nothing: the
  wallet is already updated.
- **The result is shown on the wheel and on the table:** the number, the winning spots lit up, how
  much was won or lost, and the new wallet.
- **GMs control it on `/gm/roulette`:** an on/off switch, the bet limits, and what the house has
  taken and paid.
- **It starts switched off.** Until a GM opens it, players see the wheel and table with a note that
  it opens soon, and cannot bet.
- **A new menu group, "Try Your Luck",** holds Roulette and the Wheel of Fortune (moved out of the
  top row). Later mini games go here.

## Bets and payouts

| Bet | Covers | Pays |
|---|---|---|
| A number | one of 0 to 36 | 35 to 1 |
| Red, Black | 18 numbers each | 1 to 1 |
| Odd, Even | 18 numbers each | 1 to 1 |
| 1 to 18, 19 to 36 | 18 numbers each | 1 to 1 |
| A dozen (1 to 12, 13 to 24, 25 to 36) | 12 numbers | 2 to 1 |
| A column | 12 numbers | 2 to 1 |

"35 to 1" means the stake comes back with 35 times as much on top. Zero is green: it wins only for a
chip on 0, and every other spot loses. That zero is the house's whole advantage, 1 in 37 or about
2.7% of everything staked, the same on every bet. The page shows this table and that figure.

Red numbers are the standard ones: 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36.
Pockets run in the standard European order: 0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11,
30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26.

### Chips and limits

Bets are in whole Silver (1 Gold is 1000 Silver). The chips are 10 Silver, 50 Silver, 100 Silver,
500 Silver, 1 Gold and 5 Gold. A chip that no allowed bet could use is not offered.

Three limits, set by GMs:

| Limit | Starts at |
|---|---|
| Smallest bet on one spot | 10 Silver |
| Largest bet on one number | 1 Gold |
| Largest bet on one other spot | 10 Gold |

With these, the most one spin can pay on a single number is 36 Gold, and the most a player can lose
in one spin is what they chose to put down. The GM page refuses limits above 1,000 Gold or below
1 Silver, and a smallest bet larger than either largest bet. Changing limits takes effect from the
next spin.

There is no limit on how many spins a player makes in a day. The spin request is throttled per
minute like the wheel's, far above what the eight-second animation allows by hand.

If the setting rows are missing (the SQL has not been applied to this database), the table counts as
closed and the page shows these starting limits. While the table is closed nobody can bet, GMs
included.

## How a spin works

1. The browser sends `POST /api/roulette/spin` with the character's ID and the list of bets (spot
   and amount).
2. The API checks the bets against the limits: known spots, no spot twice, each amount within its
   limit and in whole Silver.
3. The API draws a pocket from 0 to 36 with the operating system's random source and works out what
   the bets pay.
4. In one database transaction it:
   - checks the table is switched on;
   - locks the account's rows in the game's online list (`TCURRENTUSER`) so a login for that account
     waits until the bet is finished. The lock is a range lock on the account's ID (`UPDLOCK,
     HOLDLOCK, FORCESEEK`; the table has an index on `dwUserID`, and `TEnterServer` updates by
     `dwUserID`), so it also covers an account with no online row yet. It holds up that account, and
     at most the accounts next to it in the online list, for the milliseconds the bet takes.
     `FORCESEEK` keeps the lock on that index: read by a scan, it would cover the whole list and every
     login would wait. A database with no index to seek on refuses the bet and writes nothing;
   - checks the character belongs to the account, is not deleted, and is not in the online list;
   - checks the wallet holds at least the total stake;
   - sets the wallet to what it was, less the stake, plus the payout;
   - records the spin: account, character, pocket, bets, stake, payout and the wallet afterwards.
5. The API answers with the pocket, the winning spots, the payout and the new wallet. The page then
   turns the wheel to that pocket.

If any check fails nothing is written, and the API refuses with a clear message: the table is
closed, "log out of Mounara in the game first", not enough money, or a bet outside the limits (the
page then reloads the limits).

**Why an offline wallet is safe to change.** The map server marks a character online before it loads
the wallet (`TEnterServer` runs ahead of the character load) and removes the mark only after the
final save (the save is queued ahead of the logout). There are two narrow exceptions:

- When the game kicks a session out (`OnCS_KICKOUT_REQ` in TMapSvr's `CSHandler.cpp`), the handler
  starts closing the session and, in the same step, queues the clearing of the online mark. The
  final save is not part of that step; it comes once the session has closed, so the mark is gone
  before the save is queued.
- A character switch that lands on a different map server process is ordered across two queues,
  one per process, so nothing makes the old process's final save come before the online mark goes.

In both, a bet made inside that short window is overwritten by the game's own save: a lost stake
comes back and a win is lost, so no money is created, but the spin stays in the history. Outside
those windows, while a character is not in the online list, the wallet in the database is the real
one and nothing in the game will overwrite it. An account
that is only at the character list has an online row with no character in it; betting is allowed
then, and the lock in step 4 makes entering the game wait for the bet. A stale online row left by a
crashed server blocks betting until a GM clears it with the existing Logins tool.

The spin and the wallet change are one transaction, sent to the database as a single batch, so a
spin is never recorded without its money moving and never paid twice, and a stalled portal process
cannot be left holding the lock. Two spin requests for one character at the same moment run one after
the other.

## Approaches considered

**How the money moves**

- **Chosen: the portal runs the whole bet as one transaction**, using the table names from its own
  configuration. Works the same against the test and the live databases, and needs no game server
  rebuild. The gear effect tool already writes to offline characters this way.
- *A stored procedure in the game database, like the Wheel of Fortune.* The game's own procedures
  name `TGLOBAL_GSP` directly to reach the online list. A roulette procedure in the test database
  would have to do the same and would then check the live online list.
- *Stake from the wallet, winnings by in-game letter.* Winnings could not be bet again until
  collected in the game, and money would be in two places with two ways to go wrong.
- *A roulette NPC in the game.* Needs client and map server work; the point here is the portal.

**How the wheel looks**

- **Chosen: a top-down wheel drawn in SVG**, moved by a small animation loop. Light on phones, built
  like the Wheel of Fortune, and its geometry can be unit tested.
- *A 3D wheel with three.js* (already used for mounts). More lifelike, but heavier on phones, slower
  to build, and the look cannot be checked on the build machine.

## Pages

### `/roulette` (players)

On a desktop the wheel sits beside the table; on a phone the wheel is on top and the table below it,
turned upright (numbers three across, twelve rows down, the other bets alongside), so every spot is
at least 44 px to tap.

```
 Roulette
 Put your coin on the felt and let the ball decide.

 Playing with  [ Mounara (level 60 Archer) v ]      Wallet  12 Gold 340 Silver

  .---------------.     +---+----+----+----+-- - - --+----+------+
  |    wheel      |     |   |  3 |  6 |  9 |         | 36 | 2:1  |
  |   and ball    |     | 0 |  2 |  5 |  8 |   ...   | 35 | 2:1  |
  |               |     |   |  1 |  4 |  7 |         | 34 | 2:1  |
  '---------------'     +---+----+----+----+-- - - --+----+------+
   Last numbers             |   1 to 12   |  13 to 24  | 25 to 36 |
   17 0 32 5 21 ...         | 1-18 | Even | Red | Black | Odd | 19-36 |

  Chips  (10S) (50S) (100S) (500S) (1G) (5G)      On the table  1 Gold 200 Silver
  [ Undo ]  [ Clear ]  [ Same bets again ]                        [  SPIN  ]

  How it pays        Your last spins        Big wins
```

- **Placing chips.** The player picks a chip, then taps a spot to add it. Each spot shows its chip
  stack and amount. Undo takes back the last chip, Clear empties the table. A tap that would pass a
  limit or the wallet is refused with a short reason. Spin is disabled with nothing on the table.
- **The wheel.** Wooden rim, ball track, the ring of numbered red, black and green pockets, and a
  centre turret. On Spin the wheel turns one way and the ball runs the other way round the track,
  slows, drops inward, bounces once or twice and comes to rest in the winning pocket, then rides
  round with the wheel as it slows. About eight seconds. With "reduce motion" set in the browser it
  jumps straight to the result.
- **The result.** The number is shown large in its colour, the winning spots on the table light up,
  and a line says "You won 3 Gold 600 Silver" or "No win this time". "Won" is everything paid back,
  stake included, and the amount staked is shown beside it, so a spin that paid back less than it
  cost does not read as a profit. The stake leaves the wallet figure the moment Spin is pressed, and
  whatever was won is added only now, so the figure never gives the result away. A refused spin puts
  the stake straight back. The table is then cleared; "Same bets again" puts the
  last layout back if the wallet and limits allow it.
- **Last numbers.** The player's own last 15 results as coloured numbers, as on a real table's
  board.
- **Below the table:** the payout table with the house's share, the player's last 10 spins (number,
  staked, won), and "Big wins": the last 10 spins by anyone in which a number bet won, as
  "Mounara hit 17 and won 36 Gold".
- **States:** table closed; no characters; every character online; ready; spinning; result.

### `/gm/roulette` (GMs)

- The on/off switch and the three limits. Every change writes a row to the GM audit log.
- Totals for today and for all time: spins, staked, paid out, and the house's result (staked less
  paid out).
- The latest 20 spins by anyone: when, character, number, staked, paid.
- "Roulette" is added to the GM menu.

### Menu

The top row loses "Wheel" and gains a group, "Try Your Luck", with "Roulette" and "Wheel of
Fortune". The phone menu shows the same group. Soul Lottery stays under Tools: it is a calculator
for an in-game feature, not a game on the portal.

## Where things live

| What | Where |
|---|---|
| Spins (history, totals) | `TGAME_GSP.dbo.TPORTALROULETTESPIN` |
| Switch and limits | `TGAME_GSP.dbo.TPORTALSETTING`, keys `roulette_live`, `roulette_min_bet`, `roulette_max_number`, `roulette_max_outside` |
| Table script | `apps/api/sql/TPORTALROULETTESPIN.sql` |
| API | `apps/api/src/roulette/` (controller, service, repository) |
| Rules shared by page and API (spots, payouts, pocket order, colours, bet checks) | `packages/shared/src/roulette.ts` |
| Player page, GM page | `apps/web/src/routes/_authed/roulette.tsx`, `apps/web/src/routes/_authed/gm/roulette.tsx` |
| Wheel, table and chips | `apps/web/src/components/roulette/` |

A spin row holds: ID, account, character ID and name, time, pocket, total stake, total payout, the
wallet afterwards, and the bets as compact text (for example `n17:100,red:500`, amounts in Silver).
Money totals are stored in Bronze as 64-bit numbers, the way the game adds money up. The spin table
is roulette's own. What the next game reuses is the offline character picker and the code that moves
money in a wallet, not a shared table of rounds.

## Rolling it out

- The SQL is additive: one new table and four setting rows. No game server restart or rebuild.
- It is applied to `TGAME_GSP_TEST` while building. Applying it to any other database waits for the
  owner's go-ahead, with `apply.sql` and `undo.sql` in `db_changes\2026-11-14-portal-roulette` and
  an entry in the game changes ledger.
- After that the table is visible but closed. A GM checks the limits and opens it.

## Testing

- **Unit:** what every kind of bet pays on every pocket, including zero; the bet checks (unknown
  spot, spot twice, under and over each limit, not whole Silver); wallet arithmetic across Gold,
  Silver and Bronze; the wheel's geometry (the angle of each pocket).
- **HTTP:** login needed; a non-GM cannot reach the GM routes; spin answers and each refusal.
- **Database** (against `TGAME_GSP_TEST`, each case in a rolled-back transaction): a win and a loss
  change the wallet by exactly the right amount; an online character is refused; someone else's or a
  deleted character is refused; too little money is refused; table closed is refused; a refused spin
  writes nothing; the spin row matches the wallet change.
- **Web:** the page's states, placing and removing chips against limits and wallet, the spin flow
  with the result shown after the wheel stops, "Same bets again", the GM switch and limits, the menu
  group.
- No browser runs on the build machine, so the owner checks the look and the animation on a desktop
  and a phone.

## Left to the builder

- The exact names of spots in the API and of columns in the spin table.
- How the ball's path is computed, as long as it ends in the pocket the server chose.
- The look of chips and felt within the portal's existing style.

## Not in this version

- Bets across several numbers: split, street, corner and six-line. They need taps on the lines
  between numbers, which is fiddly on a phone. Bets are stored as a list of spots, so they can be
  added later without changing the data.
- In-game announcements of big wins.
- Sound.
- Daily limits on spins or losses, and any minimum character level.
- Betting with a character that is online.
- A shared table where several players bet on the same spin.
- A 3D wheel.
