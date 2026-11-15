# Slots jackpot: lost rounds build one pot that must be won

What counts as a lost round, and the share it adds, changed on 2026-11-15: see 2026-11-15-slots-modern-design.md.

Date: 2026-11-15. Adds to `2026-11-14-slots-design.md`, which listed a growing jackpot under "Not in
this version".

## Why

The owner wants a reason to keep playing. Today the three machines keep about 4% of everything
staked, and that money simply leaves the game. With a jackpot, every lost round adds to one big pot
that a player wins, so all the money the machines keep is eventually won by someone.

## Goals

- One jackpot shared by all three machines, visible and growing on the slots page.
- Every lost round feeds it.
- It is certain to be won: the page says the amount it must be won before.
- The slots never pay out more than was staked. No gold is created.

## Not goals

- A jackpot per machine.
- Changing the reels or the payout tables. The machines and their published returns stay as they are.
- A jackpot for roulette or the wheel.
- GMs adding gold to the pot. That would create gold.
- In-game announcements and sound.

## What would make it a failure

- The slots paying more than they take, at any stake or cap a GM can set.
- A pot figure that gives a spin's result away before the reels stop.
- Anyone, a GM included, being able to know in advance which spin wins.

## What it does

- **A lost round adds a share of its stake to the pot.** A lost round is a spin that pays nothing. A
  spin that pays any prize adds nothing.
- **The share is the machine's own keep, no more.** Most of the lost stakes already go back out as
  the normal wins, so only the part the machine really keeps can go to the pot. The share is counted
  from the reel strips, exactly as the return is:

  | Machine | Keeps, of all stakes | A spin loses | A lost round adds |
  |---|---|---|---|
  | Tranus's Shelf | 4.17% | 75.0% of the time | 5.57% of its stake |
  | The Armoury | 4.30% | 83.4% | 5.15% |
  | Dragon's Hoard | 3.90% | 90.0% | 4.34% |

  A lost 50 Silver round on Tranus's Shelf adds 2 Silver 784 Bronze. The share is
  `(results − prize multiples paid) / (results − results that pay)` from the same counting that pins
  the return (1368 / 24564, 1408 / 27331 and 1279 / 29493 today), and the amount is rounded down to
  whole Bronze. Rounding down is the only thing the house still keeps.
- **With the jackpot the slots pay back everything staked, over time.** They stop taking gold out of
  the game. That is the point of the change.
- **The pot must be won before it reaches a cap.** GMs set the cap; it starts at 50 Gold.
- **A jackpot keeps the cap it started with.** A pot takes the cap that is set when its first lost
  round is added, and keeps it until it drops. A cap a GM changes applies from the next jackpot. So
  "must be won before 50 Gold" stays true for the players spinning against it, and a GM cannot move
  the cap onto a pot and take it.
- **It can drop on any lost round once the pot has passed a tenth of the cap** (5 Gold at the
  starting cap). The lost round that makes it drop wins the pot. The closer the pot is to the cap,
  the likelier each lost round is to win it, and a round that would take the pot to the cap or past
  it always wins.
- **A bigger stake is likelier to win it, in proportion.** A round's chance follows what it adds, so
  a 200 Silver round has twenty times the chance of a 10 Silver round, and no machine or stake is the
  clever one to play.
- **The winner gets the pot in whole Silver,** straight into the wallet in the same step as the
  spin. Any odd Bronze stays as the start of the next pot. The next pot starts from there, not from a
  seed.
- **GMs get a jackpot switch and the cap on `/gm/slots`,** with the pot, what has gone in and out,
  and who won it.

### How big and how often

Only about 4% of stakes reach the pot, so it grows slowly. At the starting stakes an average spin
adds about 1 Silver on Tranus's Shelf, 2 on The Armoury and 4 on Dragon's Hoard. With a 50 Gold cap
the pot drops at 27 Gold 500 Silver on average, which is about 7,000 spins if everyone plays Dragon's
Hoard at 100 Silver and about 26,000 if everyone plays Tranus's Shelf at 25 Silver. The cap is the
knob: a lower cap drops more often and smaller.

For comparison, the largest ordinary win at the starting stakes is 5, 25 and 100 Gold.

## How the drop is decided

Each lost round is given a chance, and one random draw decides it. No drop point is stored anywhere.

- `pot` is the pot before the round, `add` what the round adds, `cap` this pot's own cap, `floor` a
  tenth of that cap, all in Bronze.
- `from = max(pot, floor)` and `to = max(pot + add, floor)`.
- If `from >= cap` the round wins. Otherwise it wins with chance `(to − from) / (cap − from)`, and
  always when `to >= cap`.

This gives exactly the same result as drawing a secret drop point evenly between the floor and the
cap when a pot starts and paying the round that crosses it. It is chosen over a stored drop point
because there is nothing to peek at in the database: nobody, a GM or the owner included, can know
which round will win.

The pot's row holds its own cap. It is empty until a lost round first adds to the pot; that round
writes the cap set at that moment, and a drop empties it again. `from >= cap` cannot happen while
caps only change between pots; the rule is there so a hand-edited row still ends in a drop.

The API draws the random number for each spin with the operating system's random source, as it draws
the reel stops, and the database step compares it using whole numbers, because only that step sees
the pot under lock. Tests replace the draw.

Near the cap a spin is worth more than it costs. That is intended: it is the rush that makes the pot
drop, and the money in it is all money players already lost.

## How a spin changes

Steps 1 to 3 of the slots design stay. Then:

4. The API works out what the round adds: nothing if the line pays or the jackpot is switched off,
   otherwise the machine's share of the stake. It reads the cap and draws the jackpot's random number.
5. The money step runs as one transaction, as now. For a round that adds something it also locks the
   pot, adds to it, decides the drop, and on a drop empties the pot to its odd Bronze and adds the
   whole Silver to what the wallet is paid. The spin's row records what it added and any jackpot it
   paid. Either all of it happens or none of it.
6. The API answers with the stops, the prize, any jackpot won, the new wallet and the state, which
   now includes the pot and the cap.

The pot always equals everything spins have added less every jackpot paid. Both are on the spin
rows, so this can be checked at any time, and a test does.

Every refusal stays as it is, and a refused spin adds nothing. The shared money step
(`walletBetSql`) gains a place for a game's own step before the wallet is written. Roulette does not
use it and must behave exactly as before.

Lost rounds from all players wait for the pot's lock one at a time. The locks are always taken in
the same order (the online list, the character, the pot), and the step is short.

**The spin throttle becomes 30 a minute for each account,** from 60 a minute for each IP address.
The reels allow about 24 by hand. Near the cap every spin is worth having, so a script that spins
without waiting for the reels should not get more turns than a person, and two players behind one
address should not share a limit. It is the first throttle in the API counted by account.

## Pages

### `/slots`

```
 Slots

 JACKPOT  31 Gold 420 Silver        must be won before 50 Gold
 [==================------------]
 Every lost round adds to it, on any machine. Last won by Mounara: 27 Gold 310 Silver.

 [ Tranus's Shelf ] [ The Armoury ] [ Dragon's Hoard ]
 ...the machine, as now...

   No win this time. You staked 50 Silver.          (the pot above has grown)

   JACKPOT! This round made it drop. You won 31 Gold 420 Silver.
```

- **The jackpot banner** sits above the machine tabs, since it belongs to all three: the pot in Gold
  and Silver, a bar showing how far it is to the cap, "must be won before 50 Gold", and the last
  winner with the amount. On a phone it shrinks to one line (pot and cap), because Spin still has to
  be on screen when the page opens.
- **The pot holds still during a spin,** like the wallet: the figure from when Spin was pressed
  stays until the last reel stops, then shows the new pot. So neither a growing pot nor an emptied
  one gives the result away.
- **A jackpot win** is told when the last reel stops, on a line that paid nothing: the result line
  becomes the jackpot line, marked as a win, and the banner celebrates briefly (not with "reduce
  motion" set). The wallet takes the jackpot at that moment.
- **The pot keeps up with other players:** the page reads the state at least every 15 seconds
  instead of every 60.
- **What it pays** gains: "A lost round on this machine adds 5.6% of its stake to the jackpot. With
  the jackpot, the slots pay back everything staked, over time." The figure comes from the same
  calculation the API uses.
- **Your last spins** shows a jackpot round as "won the jackpot, 31 Gold 420 Silver". **Big wins**
  lists jackpots too: "Mounara won the jackpot, 31 Gold 420 Silver".
- **Jackpot switched off:** the banner shows the pot with "The jackpot is paused", and the pays text
  drops its jackpot sentences.
- **Jackpot not readable** (its table is not in the database yet): no banner.

### `/gm/slots`

- **A Jackpot section** under the floor switch: its own switch; the cap in whole Gold, from 1 to
  10,000, with "can drop from 5 Gold, must drop before 50 Gold" following what is typed; the pot now
  with the cap it is running under; all-time added, paid and number of drops; and the last 10 drops
  (when, character, machine, amount).
- **A changed cap says when it applies.** While the running pot has a different cap from the one
  set, the section shows both: "This jackpot must drop before 50 Gold. The next one: 80 Gold." A cap
  typed wrong can be corrected at any time before the running pot drops.
- **Each machine's totals** gain "To the jackpot", and the house result becomes staked less paid
  less what went to the jackpot.
- **Latest spins** marks a round that won the jackpot, with the amount.
- Changing the switch or the cap writes a row to the GM audit log.

Switching the jackpot off keeps the pot. While it is off, lost rounds add nothing and the pot cannot
drop, so the machines keep their share again.

## Where things live

| What | Where |
|---|---|
| The pot and the cap it is running under | a new one-row table in the game database, `TPORTALSLOTJACKPOT`, Bronze |
| What a spin added, and any jackpot it paid | two new columns on `TPORTALSLOTSPIN`, Bronze, 0 by default |
| Jackpot switch, and the cap for the next jackpot | `TPORTALSETTING`, keys `slots_jackpot_live` and `slots_jackpot_cap` (whole Gold) |
| The share a lost round adds, and the drop's chance | `packages/shared/src/slots.ts`, beside the counting of every result |
| Table script | `apps/api/sql/` |
| Everything else | the existing slots files in `apps/api/src/slots/` and `apps/web/src/` |

Missing setting rows mean the jackpot is on with a 50 Gold cap. The pot starts empty: spins made
before the jackpot existed are not carried into it.

Player-facing amounts stay in whole Silver, as everywhere else in the slots. Only the pot itself and
what each round adds are kept to the Bronze.

## Known limit: what a GM can still do to a running pot

Found in the final review on 2026-11-15, and left for the owner to decide. Nothing in the code
prevents it today.

- **Stakes.** A GM can raise a machine's stakes to as much as 100 Gold, and a GM can also play. A
  round's chance of winning the pot follows what it adds, so a lost 100 Gold round on Dragon's
  Hoard adds 4 Gold 340 Silver: with the pot at 40 Gold under a 50 Gold cap, that one lost round has
  about a 43% chance of winning it. At the usual top stake of 200 Silver the same would take over a
  thousand lost rounds. A GM could raise the stakes, spin a few times and put them back.
- **The switch.** A GM can pause the jackpot while other players are close to winning it, and
  switch it on again when it suits them.

Both actions write a row to the GM audit log, and the spins themselves are on the GM page. That is
the only control, which is what this design rejected for the cap. The ways to close it are to make
a stake change apply from the next jackpot, as a cap change does, or to limit how much of one round
counts toward the drop.

## Approaches considered

**How the jackpot is won** (the owner chose)

- **Chosen: it must drop before a cap.** Certain to be won, fair across stakes and machines, and
  more tempting the closer it gets.
- *Three top symbols win it.* The classic way, but that line comes once in 8,000 to 16,000 spins, so
  the pot could sit for weeks, and a 10 Silver spin could take a pot built by 200 Silver spins.
- *A flat chance on every spin.* Could drop moments after the last one, with almost nothing in it.

**What feeds it**

- **Chosen: a share of each lost stake, sized to what the machine really keeps.** The slots then pay
  back exactly what they take, and the reels are untouched.
- *The whole lost stake.* The lost stakes are what pay the normal wins, so the slots would pay back
  about 170 to 185% and create gold.
- *Smaller reel prizes to make a bigger pot.* Means retuning three machines whose returns are
  published and pinned by tests.

**One pot or three**

- **Chosen: one pot for all machines.** The pot is only 4% of stakes, so splitting it three ways
  would make three small ones.

**How the drop is drawn** (builder's call)

- **Chosen: a chance on each lost round.** Nothing secret is stored.
- *A stored secret drop point.* The same odds, but readable in the database by anyone with access.

**When a changed cap applies** (builder's call)

- **Chosen: from the next jackpot.** The promise on the page holds, and a GM who also plays cannot
  set the cap to the pot and win it with one cheap spin.
- *At once.* Simpler, but it allows exactly that, with the audit log as the only control, and
  raising the cap would take back what players were spinning for.
- *At once, but refused near the pot.* Needs a rule for "near" and still lets the cap be raised away
  from players.

## Rolling it out

- The SQL is additive: one new table with its one row, and two columns with a default on the spins
  table. No game server restart.
- The SQL has to be in a database before the new API spins against it. Until it is, the page opens
  without a banner and a spin is refused with "Slots are not available right now".
- It is applied to `TGAME_GSP_TEST` only while building. Any other database waits for the owner's
  go-ahead, with `apply.sql` and `undo.sql` in `db_changes\2026-11-15-portal-slots-jackpot` and an
  entry in the game changes ledger. The live server still needs the slots script itself first.
- Undo drops the table and the two columns. A pot that has not been won is lost with it, so the
  undo notes say to let it drop or accept that first.

## Testing

- **Unit:** each machine's share against the table above; over every possible result, what the
  reels pay plus what lost rounds add comes to no more than the stakes, and to exactly the stakes
  before rounding; the chance below the floor, across it, between floor and cap, at the cap and with
  the cap below the pot; a round that pays adds nothing.
- **HTTP:** a lost round's answer with the pot; a drop's answer; the jackpot off; a refused spin
  never reaches the money step; the GM routes need a GM; cap limits; the spin throttle counts by
  account.
- **Database** (against `TGAME_GSP_TEST`, rolled back): a lost round moves the pot by exactly what
  it added; a drop pays whole Silver, leaves the odd Bronze, and the wallet, pot and spin row all
  agree; a winning round leaves the pot alone; pot equals added less paid after a run of spins; a
  pot keeps its cap when the setting changes and the next pot takes the new one; roulette's bet is
  unchanged.
- **Web:** the banner and its states; the pot held until the last reel stops, for a loss and for a
  drop; the jackpot line; the lists; the GM switch and cap.
- The owner checks the look on a desktop and a phone, as for the slots.

## Left to the builder

- Column names, and the exact SQL of the pot step.
- The banner's look within the portal's style, the celebration, and the exact wording of the lines.
- How the random draw is passed and compared, as long as the chance is the one above and the
  arithmetic cannot overflow at a 10,000 Gold cap.
- How the GM page lays out the jackpot section.
