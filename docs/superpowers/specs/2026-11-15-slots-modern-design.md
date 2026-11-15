# Modern slots: five reels, 20 win lines, wilds, free spins and sound

Changed on 2026-11-15 by 2026-11-15-slots-cascades-design.md.

Date: 2026-11-15. Replaces the machines of `2026-11-14-slots-design.md` and changes what the jackpot
of `2026-11-15-slots-jackpot-design.md` counts as a lost round. Everything those two documents say
that is not changed here still holds.

## Why

The owner finds the slots boring. Today a machine is three reels and one win line in a small
cabinet: a spin takes two and a half seconds in silence, a win lights three tiles and prints a line
of text, and between wins there is nothing to hope for. The owner asked for something less boring,
said modernizing it and making it bigger is fine, and asked for sound on the spin and the rest.

Two things are missing, and this work adds both:

- **Something to hope for on every spin:** more ways to win, a wild symbol, and free spins.
- **A machine that feels alive:** a bigger cabinet, sound, and a win that looks and sounds like one.

## Goals

- The three machines keep their names, themes and characters (cheap and frequent, middling, dear
  and rare) and become five-reel machines.
- Free spins are the thing a player waits for: rare enough to be an event, common enough to be seen
  in a normal session.
- Sound for the spin, each reel stopping, wins of every size, free spins and the jackpot.
- The honesty of the first version is kept: the server decides everything before anything moves,
  near misses are real, and every published figure is counted from the reel strips.

## Not goals

- Automatic play. Every round is still a press. (Free spins play by themselves: they are part of
  the round the press paid for.)
- A bonus game on another screen, expanding or sticky wilds, falling symbols, more than 20 lines,
  or a choice of how many lines to play.
- Sounds taken from the game client. Its 813 sound files are packed and unnamed; they can replace
  the made sounds later.
- Music.
- Machines GMs can design or retune. Reels and prizes stay in the code.
- In-game announcements.
- Closing the jackpot's known limit (a GM who plays can raise stakes or pause the pot). It stays as
  written in the jackpot design.

## What would make it a failure

- The slots paying out more than is staked, at any stake, with free spins and the jackpot counted.
- A published return, hit rate or largest win that differs from what the strips really give.
- A celebration for a "win" that is smaller than the stake. Twenty lines make such wins common, and
  cheering them is how slot machines mislead. They are shown plainly as what they are.
- Anything on screen or in the sound that gives a result away before its reels stop, or a staged
  near miss.
- Sound that starts before the player has pressed anything, or that cannot be switched off.
- A phone page where Spin is off the first screen.

## The new rules

### The window and the lines

- **Five reels, three rows showing.** Each reel is still a fixed loop of symbols with every stop
  equally likely, and the window shows the stop with its real neighbours above and below.
- **20 win lines, always all in play.** A line is one row position on each reel (straight rows, Vs,
  zigzags: the usual set). The 20 lines are fixed in the shared code and drawn on the page.
- **A line pays for three, four or five of the same symbol in a row from the left reel.** Each
  machine's lucky symbol also pays for two. A line pays at most its one best prize, and all winning
  lines are added together.
- **The stake covers all 20 lines.** The line stake is a twentieth of the stake, and every prize in
  the pay table is a multiple of the line stake. A prize is what the wallet gets back; the stake is
  not returned on top, as today.

### Stakes are multiples of 20 Silver

So that a twentieth of a stake is whole Silver and every win stays whole Silver, a stake must be a
multiple of 20 Silver, from 20 Silver to 100 Gold. The GM page refuses anything else. A saved stake
row that does not fit is ignored and the machine uses its starting stakes, which is what already
happens to an unreadable row.

Starting stakes: Tranus's Shelf 20, 40, 60 Silver (were 10, 25, 50); The Armoury 40, 60, 100 (were
25, 50, 100); Dragon's Hoard 60, 100, 200 (were 50, 100, 200).

### Symbols

Each machine has ten: **eight paying symbols** (its six of today and two more from the same theme),
a **wild** and a **scatter**, all from the game's own item icons.

- **Wild:** stands in for any paying symbol on a line. It is only on reels 2, 3 and 4, so it never
  starts a line and has no prize of its own. It does not stand in for the scatter.
- **Scatter:** counts anywhere in the window, not on lines. It pays nothing itself; three or more
  showing start free spins.

### Free spins

- **Three, four or five scatters showing give 8, 12 or 20 free spins,** at the stake of the spin
  that won them.
- **Every win in a free spin is doubled.**
- Free spins use the same reels. Scatters still show during free spins but give no more of them, so
  a round always ends.
- **The server plays the whole round at once:** the paid spin and all its free spins are drawn,
  added up and paid in the one money step, and recorded on one row. The page then shows them one
  after another. Closing the page halfway changes nothing: the money has already moved.

### A round

A **round** is one press: the paid spin and any free spins it won. The round's win is everything
those paid, added together. A **lost round** pays nothing at all.

### The three machines

Targets for the builder's search. The return is firm; the others may move a little, and the
builder reports what the strips really give.

| Machine | Returns (free spins counted) | A round pays something about | Free spins about once in | Most one paid spin can win, at least |
|---|---|---|---|---|
| **Tranus's Shelf** | 95 to 96.5% | one in three | 80 rounds | 200 times the stake |
| **The Armoury** | 95 to 96.5% | one in four | 120 rounds | 500 times |
| **Dragon's Hoard** | 95 to 96.5% | one in five | 160 rounds | 1,000 times |

The order matters more than the exact figures: the Shelf pays small and often, the Hoard rarely and
big.

### Every figure is counted, and pinned

Five reels of 32 stops give 33,554,432 results, too many to count on every page load as today. So:

- Each machine carries its counted figures in the code as plain numbers: the return, how often a
  round pays, how often free spins come, the most one paid spin can win, and the share a lost round
  adds to the jackpot.
- **A test counts every result from the strips and fails if any stored figure is wrong.** A strip
  cannot change without the figures changing with it.
- The page, the GM page and the API read the stored figures. Nothing counts 33 million results at
  run time.
- The return with free spins is exact, not simulated: what one spin pays on average, plus the
  chance of each number of free spins times that many doubled average spins.

### The jackpot

The jackpot works as designed. Three things follow from the new rules:

- **A lost round is a round that pays nothing,** free spins included. Only a lost round adds to the
  pot and only a lost round can make it drop. A round with free spins that all pay nothing is a
  lost round (it is very rare).
- **The share a lost round adds is recounted:** what the machine keeps, divided by how often a
  round is lost. It is stored as two whole numbers and rounded down, so the slots still never pay
  back more than is staked. With the targets above (a round lost about 67%, 75% and 80% of the
  time) it comes to roughly 4.5 to 7.5% of a lost stake, about what it is today (5.57%, 5.15% and
  4.34%). The hit rates in the machines table are the target; the share is whatever follows from
  the strips, and the builder reports it.
- The page's sentence becomes "A lost round on this machine adds N% of its stake to the jackpot."
  with the new figure.

Money already in the pot stays in it.

## Sound

- **Made in the browser** with its built-in sound generator (Web Audio). No sound files, nothing to
  download, no licence to check.
- **The sounds:** the press; the reels turning; each reel stopping; a scatter landing (each one
  higher than the last); the rising sound while free spins are still possible; a win, in sizes; the
  money counting up; a big win; free spins starting, and their total at the end; the jackpot; and a
  dull sound for a refused spin.
- **On until switched off.** A sound button sits on the cabinet and the browser remembers it.
  Nothing sounds before the player's first press, which is also what browsers require.
- Sound follows what is on screen: a reel's stop sounds when that reel stops, a win when it is
  shown. It never runs ahead of the reels.
- "Reduce motion" does not switch sound off: they are different wishes. With reduced motion the
  result appears at once with one sound for it.
- Where the browser has no sound generator (and in the tests), every sound call does nothing.

## How a round feels

- **Spinning.** The five reels start together and stop left to right, about three seconds in all.
  **Quick spin** (a switch, remembered) halves that.
- **Stopping early.** Pressing Spin or the space bar while the reels turn stops them at once on
  their result. The result was decided before they started.
- **Waiting for the third scatter.** When two scatters are showing and reels are still turning,
  those reels turn about a second longer each with the rising sound. This is honest: it only
  happens when the stopped reels really show two.
- **A win.** Each winning line is drawn across the reels in turn with its symbols lit and its
  amount, then all together, while a Win figure counts up. How loud it is depends on the round's
  win against the stake:

  | The round paid | What happens |
  |---|---|
  | less than the stake | Lines shown, the amount stated plainly, a soft tick. No fanfare. |
  | the stake up to 10 times it | Win sound, count-up. |
  | 10 to 50 times | "Big win" across the cabinet, longer count-up, coins. |
  | 50 times or more | "Huge win": the same, bigger. (50 times is also what "Big wins" lists.) |
  | the jackpot | Its own moment, above all of these. |

  Any celebration is skipped by a press.
- **Free spins.** A banner says how many were won. They then play by themselves, with "Free spin 3
  of 8" and a running total, each win doubled and shown as doubled. At the end the total is shown
  and celebrated by the table above. A "Skip to the total" control ends the show at once.
- **The wallet and the pot hold still for the whole round,** as today for one spin: the stake
  leaves on the press, and the win and the new pot appear when the round has been shown to its end.
  Spin is off until then.
- **The result in words** stays, for screen readers and for the record: "3 lines won. You won 1
  Gold 200 Silver on a stake of 40 Silver.", "No win this time. You staked 40 Silver.", "8 free
  spins won you 3 Gold 400 Silver."

## Approaches considered

**How far to take it** (the owner chose)

- **Chosen: modern machines.** Five reels, 20 lines, wild, free spins, with the new look and sound.
- *New look and sound only, same three-reel machines.* Page work alone, but between wins there is
  still nothing to hope for.
- *Three reels paying on five lines with a wild.* A middle step that still changes the rules, the
  API and the database, and still looks like an old machine.

**The existing machines** (builder's call, agreed with the choice above)

- **Chosen: all three become five-reel machines.** One set of rules to count, test and explain.
  Only test spins exist so far.
- *Keep the three and add new ones.* Two sets of rules side by side, and the boring ones stay.

**Where sound comes from** (builder's call)

- **Chosen: made in the browser.** Nothing to find, license or load.
- *The game's own sounds.* They would fit, but they are packed and unnamed.
- *A sound pack from the internet.* Files to host and a licence to keep track of.

**How free spins are played** (builder's call)

- **Chosen: the server plays the whole round in the one money step.** Nothing is left half-played
  if the page closes, and there is no "free spins owed" to store or to cheat with.
- *One request per free spin.* A round could be abandoned or replayed, and owed spins would need
  their own table and rules.

**Stakes and fractions** (builder's call)

- **Chosen: stakes in multiples of 20 Silver.** Every amount on the page stays whole Silver.
- *Any stake, wins to the Bronze.* The page would say "2 Silver" for a win of 2 Silver 500 Bronze,
  or every amount in the slots would have to show Bronze.

**Where the counted figures live** (builder's call)

- **Chosen: stored in the code and checked by a test that counts everything.**
- *Counted when needed, as today.* 33 million results on every page load and API start.

## Pages

### `/slots`

The page gets wider, so the cabinet can be about twice today's size on a desktop. On a phone it
still fits 360 pixels with Spin on the first screen.

```
 Slots
 JACKPOT  31 Gold 420 Silver            must be won before 50 Gold
 [==================------------]

 [ Tranus's Shelf ] [ The Armoury ] [ Dragon's Hoard ]
 Playing with [ Mounara (level 60 Archer) v ]        Wallet 12 Gold 340 Silver

 .--------------------------------------------------------.
 |  [potion]  [scroll]  [ WILD ]  [potion]  [tinct.]      |
 |  [ exp  ]--[ exp  ]--[ exp  ]  [scroll]  [potion]   <- line 1: three Experience Potions
 |  [scroll]  [ BOOK ]  [potion]  [ BOOK ]  [ exp  ]      |
 '--------------------------------------------------------'
   Stake (20 Silver) (40 Silver) (60 Silver)      Win  1 Gold 200 Silver

        [        SPIN        ]        [quick spin]  [sound on]

   3 lines won. You won 1 Gold 200 Silver on a stake of 40 Silver.

 What it pays  (symbols with 3, 4 and 5 alike; wild; scatter; the 20 lines)
 Your last rounds                        Big wins
```

- **The cabinet** keeps each machine's colour. Icons are 32 pixels in the game and are shown at a
  whole multiple where the screen allows (three times on a desktop), with hard edges.
- **What it pays** shows every symbol with its prizes for three, four and five (and two for the
  lucky one) as money at the chosen stake, what the wild and the scatter do, a small drawing of the
  20 lines, and the machine's counted figures: its return, how often a round pays, how often free
  spins come, the most one paid spin can win, and the jackpot sentence.
- **Your last rounds** and **Big wins** show the machine, the stake, the win and "with 8 free
  spins" where there were any. They no longer show a row of three icons: a window of fifteen says
  nothing in a list.
- All the states of today's page stay (floor closed, machine closed, no characters, in the game,
  not enough money, stakes changed).

### `/gm/slots`

Unchanged in what it offers. Stakes must now be multiples of 20 Silver; each machine's return is
read from its stored figures; the latest rounds show free spins where there were any.

## How a round works

1. The browser sends `POST /api/slots/spin` with the character, the machine and the stake, as now.
2. The API checks the machine and the stake, as now.
3. The API draws five stops. It reads the line wins and counts the scatters. If free spins were
   won it draws five stops for each of them and reads their doubled wins. All draws use the
   operating system's random source, in a fixed order that tests can replace.
4. It adds up the round. If the round paid nothing and the jackpot is on, it works out the share
   and draws the jackpot's number, as now.
5. The money step runs once, as now, and records one row for the round: the five stops, the stops
   of every free spin, the stake, the total paid, and the jackpot's part.
6. The API answers with the round (the paid spin's stops and each free spin's stops), the total,
   any jackpot, the new wallet and the state. The page works out which lines won from the stops
   with the same shared rules the API used, and plays the round.

The spin throttle goes from 30 to 45 a minute for each account: quick spin allows about 40 presses
a minute by hand, and free spins need no requests.

## Where things live

| What | Where |
|---|---|
| Machines (strips, prizes, symbols, stored figures), the 20 lines, the rules that read a window, and the counting | `packages/shared/src/` (today's `slots.ts`, split if it grows unwieldy) |
| The round on a row | `TPORTALSLOTSPIN` gains stops 4 and 5, the free spins' stops, and a rules number |
| Sound | a new file in `apps/web/src/lib/` |
| Reels, lines drawn on the reels, celebrations, pay table | `apps/web/src/components/slots/` |
| Everything else | the existing slots files |

**Rows from the old rules.** The spins table has only test spins, on this machine. They are not
deleted: every row gets a rules number (1 for the old three-reel spins, 2 for new rounds), the
lists on both pages show only rules 2, and the GM totals still count everything, because the money
was real.

The old three-reel rules and their tests are removed from the code.

## Rolling it out

- The SQL is additive: new columns with defaults on `TPORTALSLOTSPIN`. No game server restart.
- The SQL has to be in a database before the new API spins against it. Until it is, a spin is
  refused with "Slots are not available right now", as with the jackpot.
- It is applied to `TGAME_GSP_TEST` only while building. Any other database waits for the owner's
  go-ahead, with `apply.sql` and `undo.sql` in `db_changes\2026-11-15-portal-slots-modern` and an
  entry in the game changes ledger. On the live server the order is: slots, jackpot, this.
- GM-saved stakes that are not multiples of 20 Silver fall back to the starting stakes. On this
  machine no stakes have been saved.

## Testing

- **Unit:** the full count per machine against its stored figures (slow: it runs as its own test
  file); the return within 95 to 96.5%; over every result, what rounds pay plus what lost rounds
  add comes to no more than the stakes; chosen windows (a line of three, four, five; two lucky; a
  wild completing a line; a wild not starting one; scatters off the lines; three, four and five
  scatters; no more free spins from a free spin; two lines at once; one prize per line); the 20
  lines are all different and all valid; every symbol has an icon; stake checks (multiples of 20).
- **HTTP:** a round's answer with and without free spins, with the draws replaced; a lost round
  feeds the pot and a paying one does not; a round whose only wins are in free spins is not a lost
  round; refusals; the throttle.
- **Database** (`TGAME_GSP_TEST`, rolled back): the wallet moves by exactly the round's total; the
  row holds all five stops and the free spins; old rows stay out of the lists and in the totals;
  pot equals added less paid.
- **Web:** the round's flow with the wallet and pot held until the end, with and without free
  spins; stopping early; skipping; the win tiers, and that a win below the stake gets no
  celebration; quick spin; the sound switch remembered, and no sound call before the first press;
  the reels' motion for five reels.
- **In a real browser:** one watched browser instance against a static build with canned answers,
  for the phone layout and the lines' alignment on the reels. Sound cannot be judged by a test:
  the owner listens on a desktop and a phone.

## Left to the builder

- The exact strips and prizes, within the targets, found by search and pinned by the counting test.
- The two extra paying symbols, the wild and the scatter for each machine, from the game's icons.
  The owner sees them on the page and can ask for others.
- The exact 20 line shapes, the length of a strip (32 unless the search needs otherwise and the
  counting test stays practical), and how the count is made fast enough.
- The design of each sound, the cabinet's look, the celebrations and all timings, within the
  portal's style. The owner will listen and look and ask for changes.
- Column names, how the free spins' stops are stored on the row, and the answer's exact shape.
- The exact wording of the lines.
- Whether the round's show is driven by one hook or several, and how today's `useHeldSpin` is
  reused for a round with several spins.
