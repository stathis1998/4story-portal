# Slots cascades: chains that pay again, richer free spins, a meter, three jackpots, and 105%

Date: 2026-11-15. Changes the machines of `2026-11-15-slots-modern-design.md` and the jackpot of
`2026-11-15-slots-jackpot-design.md`. Everything those two documents say that is not changed here
still holds.

## Why

The owner wants the slots more compelling ("addictive, for fun, it is fake money"), slightly easier
to win even if that adds some gold to the economy, with bigger combos and flashier play. This
document is the first of three pieces of that request: **the maths**. Everything that changes what a
round pays belongs here, so the returns are searched and counted once. The other two pieces follow
as their own designs:

- **Flashier animations** (bursts, falling symbols with weight, multiplier reveals, bigger
  celebrations). This document builds only what a cascade needs to be playable and honest; the
  second piece makes it spectacular.
- **Around the slots**: a "hot" jackpot state, slots leaderboards, slots achievements, a symbol
  collection book, in-game announcements of big wins, and timed GM slots races.

## Decisions the owner made

- **Total payback 105%** (reels, free spins, meter and jackpots together). The slots create about 5
  Gold for every 100 Gold staked.
- **Cascades** are the bigger combo.
- **The meter and richer free spins** from the list are in.
- **Three jackpots:** Mini, Major and Giga, each its own pot that must drop before its own cap.
- **A daily limit of 1,500 rounds per account** against scripted farming.
- The proposals played back in conversation (below, marked) were accepted as a whole.
- Built in a worktree.

## Goals

- A spin can win several times in a row, each step paying more, from one press.
- Free spins feel like an event: a multiplier that keeps climbing and spins that can win more spins.
- A player always has something filling up: the meter, and three pots, the smallest of which drops
  often.
- The three machines keep their names, symbols and character: Tranus's Shelf small and often, The
  Armoury in between, Dragon's Hoard rare and big.
- Everything stays honest: the server decides the whole round before anything moves, near misses
  are real, and every published figure is counted from the strips.

## Not goals

- Automatic play. Every round is still a press.
- A bonus game on another screen, a "pick a box" feature, or buying free spins.
- Daily free spins or login bonuses.
- Changing the 20 lines, the wild or the scatter, beyond what is written here.
- The animations and the "around the slots" features (the next two designs).

## What would make it a failure

- Any published figure (return, how often a round pays, free spin rate, largest win, jackpot
  share) that differs from what the strips really give, or that can drift from them without a test
  failing.
- A total payback outside 104.5% to 105.5% on any machine, or the slots creating gold faster than
  that at any stake a GM can set.
- A cascade step, a multiplier or a jackpot shown before the server decided it, or a step shown
  that the rules did not produce.
- A chain that never ends, or a round the database cannot record in full.
- A meter that can be filled at a low stake and cashed in at a high one.
- A win smaller than the stake celebrated (unchanged from the earlier designs).
- The jackpot no longer growing because the reels pay back too much (see "Why the jackpot share
  formula changes").

## How a cascade works

The window is still five reels by three rows, the 20 lines are the same, and lines still pay from
the left reel for three, four or five alike (two for the lucky symbol), with the wild standing in.

1. **Step 1** is the window the five stops show, exactly as today.
2. **A step that wins** pays all its winning lines added together, times the step's multiplier.
3. **The winning tiles burst.** A tile bursts if it lies on a winning line within that line's paying
   count (the first three, four or five reels, or two for the lucky symbol). A tile on two winning
   lines bursts once. A wild that helped a line bursts with it. Scatters never burst, because they
   never pay on lines.
4. **The reel refills from its own strip.** On each reel, the tiles that did not burst slide down
   to the bottom, keeping their order, and the gaps at the top are filled with the next symbols on
   that reel's strip above the current top row, in strip order. A reel whose top row showed strip
   position `p` and lost `k` tiles shows positions `p - k ... p - 1` at its top, then its surviving
   tiles. Nothing is drawn: the refill is the strip continuing to turn.
5. **The new window is step 2,** read the same way. The chain continues while a step wins.
6. **The chain ends** at the first step that wins nothing, or after **12 steps**, whichever comes
   first. (The cap keeps every chain finite and every row storable; reaching it should be very rare,
   and the builder reports how rare.)

**The multiplier in a paid spin:** step 1 pays times 1, step 2 times 2, step 3 times 3, step 4 times
4, and step 5 and every later step times 5.

**Scatters** never burst, so the number showing can only stay or grow during a chain as new ones fall
in. Free spins are awarded on the scatters showing in the **last window** of the chain: 3, 4 or 5 give
8, 12 or 20 free spins, as today. A reel may now show two scatters after a cascade, so up to five
or more can show; five or more give 20.

Because the refill comes from the strips, the whole chain is fixed by the five stops. The server still
draws only stops, the page replays the chain with the same shared rules, and every result can still
be counted, window by window.

## Free spins (proposal accepted)

- **A climbing multiplier replaces today's doubling.** A free round starts at **times 2**. Every
  step that wins, in any free spin of the round, pays at the multiplier it finds and then raises it
  by 1, up to **times 10**. The multiplier is carried from one free spin to the next and resets only
  when the free round ends. (Inside a free spin there is no separate step multiplier: the climbing
  one is the only one.)
- **Retrigger:** a free spin whose last window shows three or more scatters adds **5 free spins**
  to the round. A free round never has more than **50 free spins** in all: a retrigger adds what
  still fits under 50 (at 48 spins it adds 2) and nothing once the round has 50. (Builder's call.)
- Free spins are still part of the round the press paid for: drawn, added up and paid in the same
  money step, recorded on the same row.

## The meter (proposal accepted)

- Each **paid spin** whose last window shows **one or two scatters** adds that many points to a
  meter. (A paid spin that wins free spins adds nothing: it already won them.) Points are added when
  the chain has ended, never when a reel stops: a later step can bring a third scatter and turn them
  into free spins. (Builder's call: showing points at a reel's stop would show points the rules had
  not yet given.)
- **When the meter is full it pays 8 free spins,** played straight after that paid spin as part of
  the same round, with the free spins' climbing multiplier. The meter then keeps the points over the
  size.
- **Each machine has its own meter size,** found by the search so the meter fills about as often as
  the targets say: 30 points on Tranus's Shelf, more on the other two (for example 40 and 50).
  (Builder's call. One scatter density sets both the free spin rate and the meter's fill rate, so on
  The Armoury and Dragon's Hoard a 30-point meter would fill far more often than planned, about every
  60 rounds, and take most of the payback from the reels.) The page shows the machine's own size:
  "Meter 12 / 40".
- There is **one meter for each account, machine and stake.** Points earned at 40 Silver can only be
  cashed at 40 Silver. If a GM stops offering a stake, its meters stay stored and resume if the stake
  is offered again.
- **The meter moves only inside the money step,** under lock. The API reads the meter before it
  plays the round (it must know whether meter free spins are played), so the money step locks the
  meter row, after the online list and the character and before the pots, and checks it still holds
  the points the API read. If it does not (two characters of one account, or two tabs, spinning on
  the same machine and stake at the same moment), the spin is refused with nothing moved: "Your
  meter changed. Press Spin again." The page reloads the state. (Builder's call: refusing keeps the
  fixed draw order and the exact draw counts; it should almost never happen.)
- The page shows the meter for the chosen machine and stake, with the machine's size.
- Meter free spins follow the same 50-spin limit, and do not fill the meter.

## Three jackpots (proposal accepted)

| Jackpot | Share of the jackpot money | Cap to start (GM sets it) | Can drop from | Pot row |
|---|---|---|---|---|
| **Mini** | 30% | 1 Gold | a tenth of its cap | new row 2 |
| **Major** | 30% | 10 Gold | a tenth of its cap | new row 3 |
| **Giga** | 40% | 50 Gold | a tenth of its cap | row 1, today's pot |

- **Today's pot becomes the Giga** and keeps everything already in it, with the cap it is running
  under.
- **Every lost round feeds all three,** each with its share of what the round adds, rounded down to
  whole Bronze.
- **Each pot makes its own draw** with today's rule (the closer to its cap, the likelier; a round
  that would reach the cap always wins; nothing below a tenth of the cap). Each pot keeps the cap it
  started with until it drops. The three draws are independent, so one lost round can win two or
  three pots; it is paid all of them.
- A pot that drops pays its whole Silver into the wallet in the same transaction and keeps its odd
  Bronze as the next pot, as today.
- **GMs get a switch and a cap for each pot.** The caps' limits stay 1 to 10,000 Gold, and the
  three must rise: Mini below Major below Giga. A pot switched off keeps its money, takes nothing
  and cannot drop.
- **A lost round** is a round that paid nothing in total: no line in any step of the paid spin, its
  free spins or meter free spins.

### Why the jackpot share formula changes

Today a lost round adds `(1 - R) / L` of its stake, where `R` is what the reels pay back and `L`
how often a round is lost. That makes reels plus jackpot come to exactly 100%. With reels near 101%
it would be negative and the pot would never grow. The share becomes `(1.05 - R) / L`: whatever the
reels, free spins and meter pay back, the jackpots make up the rest of 105%. It is still stored as
whole billionths, rounded down, so the total can only fall short of 105% by a hair, never pass it.
The three pots split that share 30, 30 and 40 per cent, each rounded down.

## The maths and the targets

**`R`, what a round pays back without the jackpots,** now has four parts, all counted exactly:

1. the paid spin's chain (every window played through its chain);
2. free spins won by scatters, with the climbing multiplier and retriggers;
3. meter free spins: the long-run rate at which paid spins fill the meter, times the value of 8 free
   spins;
4. nothing else.

**105% is a long-run figure, and the page says so** (builder's call). The meter makes rounds depend
on each other, and every meter starts empty and is usually left part-full, so a player who plays a
few hundred rounds at one machine and stake gets somewhat less, about 97% to 101% in the reviewer's
estimate. The pay table says: "This machine pays back 105.0% of what goes into it over time,
counting the meter and the jackpots. A short session can pay back less, and the meter only pays
when it fills." This is still exactly what the strips give, counted, not estimated: the long-run
meter value is exact because, over a long run, every point total from 0 to one below the size is
equally likely.

**How often a round is lost (`L`),** which the jackpot share needs, is worked out the same way. With
the meter's size `S`, a paid spin that adds `k` points fills the meter with chance `k / S` in the
long run, so

`L = P(chain pays nothing, no free spins, k = 0)`
`  + sum over k = 1, 2 of P(chain pays nothing, k) x (1 - k/S + (k/S) x Q8)`
`  + sum over N of P(chain pays nothing, N free spins won) x Q_N`

where `Q_N` is the chance that a free round starting with `N` free spins (and any retriggers) pays
nothing.

**Targets** (the return and the total are firm; the others guide the search and are reported):

| Machine | Reels, free spins and meter (`R`) | Total with jackpots | A round pays something | Free spins from scatters | The meter fills |
|---|---|---|---|---|---|
| Tranus's Shelf | 100% to 102% | 105% | about one in 1.8 | about once in 80 rounds | about every 60 rounds |
| The Armoury | 100% to 102% | 105% | about one in 2.0 | about once in 110 | about every 80 |
| Dragon's Hoard | 100% to 102% | 105% | about one in 2.4 | about once in 140 | about every 100 |

- **Keep the jackpots meaningful:** `R` at most 102%, so at least about 3% of stakes reach the
  three pots.
- **Order matters more than exact figures:** the Shelf pays most often, the Hoard least; the Hoard's
  biggest wins are the biggest.
- **Largest win:** the most one paid spin's chain can pay at these stakes is published, as today.
  Free spins can pay more; the page says so ("A round with free spins can win more.").

### How every figure stays counted

- **The paid spin:** a full count plays every one of the 33,554,432 windows through its chain and
  keeps, per machine: the sum paid (in line stakes, multiplier applied); how many windows pay
  nothing; the scatters in each chain's last window (exactly 0, 1, 2, 3, 4, 5 or more), split by
  whether the chain paid; the longest chain met; and the most one window's chain pays.
- **Free spins and the meter** need, for a free spin starting at multiplier `m`, its expected pay and
  the joint chances of how many steps won and whether it retriggered. Because a step's pay is its
  line total times the multiplier it finds, the full count can keep, per window, the line total of
  each step `j` (1 to 12) summed into buckets by (number of winning steps, retrigger or not, step
  `j`). A free spin starting at multiplier `m` whose chain wins `W` steps pays the sum of
  `L_j x min(m + j - 1, 10)` over its steps and leaves the multiplier at `min(m + W, 10)`, so from
  those buckets the expected pay at any starting multiplier is exact. The value of a free round, and
  the chance `Q_N` that it pays nothing, are an exact dynamic programme over (spins left, multiplier,
  spins still allowed under the 50 limit), because a retrigger near the limit adds only what fits.
  The meter's value is the long-run fill rate (from the 1- and 2-scatter counts and the size) times
  the value of 8 free spins from times 2. A test checks the programme against a brute-force
  simulation of a small fixture.
- **Stored, then pinned:** each machine stores its counts as plain numbers in the code, as today. A
  test recounts every window from the strips and fails on any difference. Nothing counts 33 million
  windows at run time.
- **The count must stay practical:** if a full count of one machine takes more than about two
  minutes on this machine, the builder speeds it up (precomputed tables, typed arrays, skipping the
  chain for windows that pay nothing at step 1) before going on.

### Searching for the strips

The strips and prizes are found by search again, as for the five-reel machines. A full count is now
too slow to sit inside a search loop, so the search uses a fast estimate (sampling, or the first
step's quick counts with a measured chain factor) to get near the targets, then confirms every
candidate with the full count. Only fully counted strips are committed. The search script is not
committed.

## Stakes

- **The most a GM can set is 5 Gold (5,000 Silver)** while the slots pay back more than they take,
  down from 100 Gold. A saved stake row above 5 Gold, like any row that does not parse, falls back
  to the machine's starting stakes.
- Starting stakes stay: Shelf 20, 40, 60 Silver; Armoury 40, 60, 100; Hoard 60, 100, 200.
- **What 105% means at the limit:** a player spinning nonstop by hand at the 5 Gold stake gains on
  average roughly 300 Gold an hour; at the starting top stake of 200 Silver, about 12 Gold an hour.
  The GM page says this next to the stakes, so a GM raising them sees the cost.

## A daily limit (the owner chose)

At 105% a script spinning at the 45-a-minute limit would gain about 675 Gold an hour per account
at 5 Gold, and that multiplies with alt accounts. So:

- **Each account may play 1,500 rounds a day** on the slots, all machines together. A day is the
  database's date, as the GM totals already use. 1,500 is about two hours of fast play; a normal
  player never meets it.
- **It is checked inside the money step,** under the account's lock that the bet already takes, by
  counting the account's spin rows since the start of today (rows of every rules number count, so
  the limit cannot be dodged across the change). A refused round moves nothing: "You have played
  today's 1,500 rounds. The slots open again for you tomorrow." The spins table gets an index on
  account and time for this count.
- **GMs can change the limit** on `/gm/slots`, from 100 to 10,000 rounds a day; a missing setting
  row means 1,500. Changing it takes effect from the next round.
- **The page shows what is left** once a player is within 200 rounds of the limit: "120 rounds left
  today". When nothing is left, Spin is off and the note above is shown.
- **What it caps:** at most about 375 Gold a day per account at the 5 Gold stake, and about 15 Gold a
  day at 200 Silver, on average.

## What the page shows (functional, not yet flashy)

The second design makes this spectacular; this one makes it playable and honest.

- **A cascade:** the winning lines are drawn and the step's win is added to the Win figure, the
  bursting tiles fade, the reel's survivors drop and the new symbols drop in from above, then the
  next step is read. The step's multiplier is shown on the cabinet ("x3"). Each step's sounds and
  figures appear only when that step is on screen.
- **Quick spin** shortens every step; **Stop** and **Skip to the total** work as today (a press during
  a chain jumps to the end of that spin's chain).
- **Free spins:** the climbing multiplier is shown throughout the free round, and a retrigger says
  "+5 free spins".
- **The meter:** shown under the stakes for the chosen machine and stake, with points arriving when
  the paid spin's chain has ended. A full meter says "Meter full: 8 free spins" and plays them.
- **Three jackpot meters** replace today's banner, each with its pot, its cap and "must drop before".
  On a phone they fit one row, and Spin stays on the first screen at 360 by 560.
- **The pay table** explains cascades, the step multiplier, the climbing multiplier, retriggers, the
  meter and the three jackpots, and gives the counted figures: total payback (105.0%), how often a
  round pays, how often free spins come, how often the meter fills, and each pot's share.
- **Result lines and lists** say how many steps the chain ran and the top multiplier reached ("A
  chain of 4. You won 1 Gold 260 Silver on a stake of 40 Silver."), meter free spins, and which
  jackpots were won.
- Everything the earlier designs guarantee about the page still holds: the wallet and the pots hold
  still until the round has been shown; no celebration below the stake; no sound before the first
  press; Spin rests 400 ms after every round; one press is one round.

## How a round works

1. `POST /api/slots/spin` with the character, machine and stake, as today.
2. The API checks the machine and the stake, as today, and reads the account's meter for this machine
   and stake.
3. It draws five stops and plays the paid spin's chain. It plays any free spins won (five stops each,
   in order, with retriggers), then, if the paid spin filled the meter, the meter's 8 free spins. All
   draws use the operating system's random source in a fixed order that tests can replace: the paid
   spin's five stops; each free spin's five stops in play order; each meter free spin's five stops;
   then the three jackpot numbers (Mini, Major, Giga) only for a lost round with at least one pot on.
4. It adds up the round, works out the jackpot adds, and runs the one money step: wallet, meter,
   pots and spin row together, or nothing.
5. It answers with the round's stops (paid, free, meter free), the total, each jackpot won, the meter
   after the round, the new wallet and the state. The page replays every chain from the stops.

The spin throttle stays 45 a minute per account. The daily limit is checked in step 4, inside the
money step, before anything moves.

## Where things live

| What | Where |
|---|---|
| Cascade rules, free round rules, the meter's rule, the figures, the counting | `packages/shared/src/` (the existing slot files, split further if one grows unwieldy) |
| A round on a row | `TPORTALSLOTSPIN`: rules number 3 for cascade rounds; the free spins' text widened to hold 50 spins; whether meter free spins were played and their stops; what the round added to and won from each pot |
| The meters | a new table, one row per account, machine and stake |
| The three pots | `TPORTALSLOTJACKPOT` gains rows 2 (Mini) and 3 (Major); row 1 stays and is the Giga |
| Pot switches and caps | `TPORTALSETTING`: today's `slots_jackpot_live` and `slots_jackpot_cap` become the Giga's; new keys for the Mini and the Major |
| Everything else | the existing slots files in `apps/api/src/slots/` and `apps/web/src/` |

**Old rows:** rules 1 (three reels) and 2 (five reels, no cascades) stay, hidden from the lists and
counted in the GM totals, as before.

## Rolling it out

- The SQL adds columns with defaults, widens a text column, adds a table and two pot rows. It is not
  purely additive: the pot table's check that only row 1 may exist is replaced by one allowing rows
  1 to 3, and undo puts the old check back after deleting rows 2 and 3. No game server restart.
- It must be in a database before the new API spins against it; until then every spin is refused
  with "Slots are not available right now".
- On the live server the order is: slots, jackpot, five-reel (`2026-11-15-portal-slots-modern`),
  then this.
- It is applied to `TGAME_GSP_TEST` while building. Any other database waits for the owner, with
  `apply.sql` and `undo.sql` in `db_changes\2026-11-15-portal-slots-cascades` and a ledger entry.
- Undo must say what is lost: meters, the Mini and Major pots (their money is gone with their rows
  unless they drop first), and cascade rounds read by an older portal.

## Approaches considered

**How far to go** (the owner chose)

- **Chosen: 105% total, cascades, the meter, richer free spins, three jackpots, in one maths
  piece.**
- *Split them up:* each change to the returns would need its own search and count, and the figures
  would be republished several times.

**Where cascade refills come from** (builder's call, accepted)

- **Chosen: the strip above.** The chain is fixed by the stops; every figure can be counted exactly;
  near misses stay real.
- *A fresh draw per step:* the return could only be estimated by simulation.
- *Outcome tables:* reels become a show and near misses get invented.

**The total payback** (the owner chose)

- **Chosen: 105%.** About 5 Gold created per 100 staked.
- *101% or 103%:* smaller and safer; the owner asked for more.

**The size of a stake** (builder's call)

- **Chosen: at most 5 Gold while the slots create gold.** At 100 Gold, 105% would make one player
  about 6,000 Gold an hour richer.
- *Keep 100 Gold:* the slots become the best gold farm in the game.

**Free spins** (builder's call, accepted)

- **Chosen: a climbing multiplier from times 2 to times 10, carried across the free round, with
  retriggers up to 50 spins.**
- *Keep the doubling:* nothing builds during the free round.

**The meter's scope** (builder's call, accepted)

- **Chosen: per account, machine and stake.** No filling cheaply and cashing dearly.
- *Per account only:* cheaper to store, but it can be gamed.

**Three jackpots** (the owner chose the tiers; the split and caps are the builder's)

- **Chosen: 30 / 30 / 40 per cent, caps 1, 10 and 50 Gold to start.**

**Stopping a script from farming** (the owner chose)

- **Chosen: 1,500 rounds a day per account, GM-adjustable.** Caps what a script can make; a normal
  player never meets it.
- *A slower spin limit (20 a minute):* halves a script's gain, but fast players hit it.
- *No new limit, GMs watch:* relies on someone noticing.

## Testing

- **Unit (shared):** a cascade on hand-built fixtures: a single step, two steps, a wild that bursts,
  a tile on two lines bursting once, the refill order (survivors keep their order, new symbols in
  strip order), scatters never bursting, the 12-step cap, the step multiplier 1 to 5 and staying 5;
  free rounds: start at times 2, carried between spins, capped at times 10, retrigger +5, the
  50-spin limit; the meter: points from 1 or 2 scatters, none from a paid spin that won free spins,
  firing at 30 and keeping the rest; the full count against stored counts for every machine (slow,
  its own file); the dynamic programme against a brute-force simulation of a small fixture; every
  machine's total between 104.5% and 105.5% and never above 105% by construction; the three shares
  adding to no more than the whole.
- **HTTP:** a round with a chain; with free spins and a retrigger; with meter free spins; a lost
  round feeding three pots; one round winning two pots; refusals; draw counts exact in every case;
  stakes above 5 Gold refused; the daily limit refusing round 1,501 with nothing drawn or moved; the
  meter changed between read and bet refused with nothing moved.
- **Database** (`TGAME_GSP_TEST`, rolled back): the meter row moves only with the spin; two pots
  dropping in one round; the Giga keeps today's pot; pots and spin rows agree; the old table refuses
  the bet and moves nothing; old rows hidden from lists and counted in totals.
- **Web:** a chain shown step by step with each step's figures appearing only when shown; the
  multiplier; Stop and Skip mid-chain; the meter; the three jackpot meters; the pay table's figures;
  the phone layout (Spin on the first screen) checked once in the browser.

## Left to the builder

- The exact strips and prizes, within the targets, found by search and pinned by the count.
- Whether the chain cap of 12 is ever reached, and reporting how often.
- Column and table names, the shape of the answer, and how the per-window buckets are stored.
- How the count is made fast enough.
- The cascade's timing and look on the page, as long as it is honest and playable (the next design
  makes it flashy).
- The exact wording of the pay table and the result lines, in the portal's plain style.
