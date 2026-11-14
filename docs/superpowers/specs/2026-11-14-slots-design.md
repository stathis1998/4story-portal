# Slots: three classic machines that take an offline character's money

Date: 2026-11-14.

## Why

The second game for the portal's "Try Your Luck" corner, after roulette. Slots are quick and simple:
pick a machine, pick a stake, pull. Several machines with different characters give players a reason
to try each, and adding another later should be a matter of describing it, not building it.

It is real gambling with game money, and the page says so: each machine shows what it pays and the
share of the stakes it returns over time.

## What it does

- **A page, `/slots`, with three machines.** Each is a classic slot machine: three reels, three
  symbols showing on each, and one win line across the middle.
- **The symbols are the game's own item icons.** Each machine has its own set of six.
- **The player picks one of their own characters that is logged out,** exactly as in roulette. The
  stake comes out of that character's wallet and winnings go straight back into it.
- **The player picks a machine and one of its three stake sizes, then presses Spin.**
- **The server decides where each reel stops** and moves the money in one step. Only then do the
  reels spin and stop, left to right, on that result. Closing the page mid-spin changes nothing.
- **The result is shown on the reels and in words:** the winning symbols lit on the line, how much
  was won, and the new wallet.
- **GMs control it on `/gm/slots`:** one switch for the whole slots floor, a switch and the three
  stake sizes for each machine, and what each machine has taken and paid.
- **It starts switched off.** Until a GM opens the floor, players see the machines and what they
  pay, and cannot spin.
- **"Slots" joins the "Try Your Luck" menu group,** and the GM menu.

## How a machine works

A machine is three **reel strips** and a **payout table**, both fixed in the code.

- A reel strip is a loop of symbols, for example 32 of them. A spin picks one stop on each reel, and
  every stop is equally likely. The page shows the symbol at the stop on the win line, with the
  strip's real neighbours above and below it. Near misses are therefore real, never staged.
- The win line pays, counted from the left reel:
  - three of the same symbol pays that symbol's prize;
  - each machine has one **lucky symbol**, its most common one, which also pays a small prize for
    two in a row from the left.
- A prize is a multiple of the stake. "Pays 20" means the wallet gets back 20 times the stake, the
  stake included. A spin pays at most one prize: the highest that applies.
- Because the strips and the table are fixed, every possible result can be counted. A test counts
  them all and pins each machine's exact **return** (the share of all stakes it pays back over time),
  how often a spin pays anything, and the odds of its top prize. The page and the GM page show the
  return from that same calculation, so the published figure cannot drift from the real one.
- Stake sizes do not change any of this: prizes are multiples of the stake.

### The three machines

| Machine | Feel | Symbols | Top prize | Returns | A spin pays about | Stakes to start |
|---|---|---|---|---|---|---|
| **Tranus's Shelf** | cheap, small wins often | potions and formulas | 100 times the stake | 95 to 96.5% | one in four | 10, 25, 50 Silver |
| **The Armoury** | middling | weapons and armour | 250 times | 95 to 96.5% | one in six | 25, 50, 100 Silver |
| **Dragon's Hoard** | dear, big wins rarely | treasure | 500 times | 95 to 96.5% | one in ten | 50, 100, 200 Silver |

With the starting stakes the largest single win is 5 Gold, 25 Gold and 100 Gold. The top prize of
each machine comes up no more often than once in 5,000 spins.

Tranus's Shelf uses, from most to least common: First-Class Healing Potion (item 7600, the lucky
symbol), Apprentice Formula (8501), Master's Formula (7602), Serendipity (7609), Survival Tincture
(7654) and Experience Potion (7714, the top prize). The other two machines get six icons each from
the game's weapons and armour, and from its treasure (saddles, gems and the like), chosen so the six
are easy to tell apart at a glance.

Icons are 32 pixels in the game and are shown at exactly double size with hard edges, each on a
tile, so they stay sharp.

### Stakes

Each machine has three stake sizes in whole Silver, lowest to highest, set by GMs. A stake may be
from 1 Silver to 100 Gold, and the three must be different. Changing them takes effect from the next
spin. The page shows the largest win the current stakes allow.

When a GM changes the stakes while a player is on the machine and the stake they had is no longer
offered, the page tells the player. It picks the machine's new lowest stake only if that is no more
than the stake they had, and otherwise picks none and waits for them to pick one.

There is no limit on how many spins a player makes in a day and no automatic play: every spin is a
press. The spin request is throttled per minute, well above what the reels allow by hand.

## How a spin works

1. The browser sends `POST /api/slots/spin` with the character's ID, the machine and the stake.
2. The API checks the machine exists and is open, and that the stake is one of its three.
3. The API draws a stop for each reel with the operating system's random source and reads the prize
   from the payout table.
4. It moves the money with the same database step roulette uses (`walletBetSql`): one transaction
   that checks the slots floor is open, locks the account's rows in the game's online list, checks
   the character is the account's, not deleted and not in the game, checks the wallet covers the
   stake, updates the wallet, and records the spin.
5. The API answers with the three stops, the prize and the new wallet. The page spins the reels to
   those stops.

Refusals are the same as roulette's, with the same wording where it applies: the floor or the
machine is closed, "log out of Mounara in the game first", not enough money, or a stake that is no
longer offered (the page then reloads the machine's stakes). Nothing is written on a refusal.

Everything roulette's design says about why an offline wallet is safe to change, and its two narrow
exceptions, applies here unchanged, because the money step is the same code.

## Approaches considered

**How a result is decided**

- **Chosen: real reel strips, a uniform stop per reel, a fixed payout table.** Honest, like a
  mechanical machine, and its return can be counted exactly.
- *Pick a prize by its chance, then arrange the reels to show it.* Easier to tune, but the reels
  become a show and near misses are invented.

**Where a machine is defined**

- **Chosen: strips and payout tables in the code; switches and stake sizes with the GMs.** Tests pin
  the return, and nothing a GM can change alters it.
- *Machines fully editable by GMs in the database.* One wrong number makes a machine pay more than
  it takes and creates gold. It would need a calculator and a guard on the GM page.

**How the reels are drawn**

- **Chosen: strips of icons in the page, moved by a small animation loop,** as the roulette wheel
  is. The motion is a pure function of time, so it can be tested.
- *A canvas.* Nothing here needs one.

## Pages

### `/slots` (players)

One column that works on a phone: the machine sits in the middle of the screen with Spin under it,
so a thumb reaches it and the reels stay in view.

```
 Slots
 Three machines, one pull at a time.

 [ Tranus's Shelf ] [ The Armoury ] [ Dragon's Hoard ]
 Playing with  [ Mounara (level 60 Archer) v ]     Wallet  12 Gold 340 Silver

          .---------------------------------.
          |  [potion]   [scroll]   [potion] |
        > |  [ exp  ]   [ exp  ]   [ exp  ] | <      the win line
          |  [scroll]   [potion]   [tinct.] |
          '---------------------------------'
   Stake   (10 Silver)  (25 Silver)  (50 Silver)

                    [      SPIN      ]

   Three Experience Potions. You won 5 Gold on a stake of 50 Silver.

 What it pays                Your last spins            Big wins
```

- **Picking a machine.** Three tabs, each with the machine's name. The last machine, stake and
  character are remembered in the browser. A machine a GM has closed is shown with "Closed" and
  cannot be spun.
- **The machine.** A cabinet in the machine's own colour holding the three reels. Each reel shows
  three symbols; the middle row is marked as the win line. Before its first spin a machine rests on a
  fixed line that pays nothing, with three different symbols on it and no row of three alike, so a
  resting machine never looks like a win.
- **Spinning.** Spin, or the space bar, sends one spin. The reels blur downward and stop one after
  the other, left to right, each with a small settle. About two and a half seconds. With "reduce
  motion" set in the browser they jump straight to the result. Spin is disabled until the last reel
  has stopped.
- **The result.** Winning symbols on the line light up, and a line says "Three Experience Potions.
  You won 5 Gold on a stake of 50 Silver." or "No win this time. You staked 50 Silver." The stake
  leaves the wallet figure the moment Spin is pressed, and whatever was won is added only when the
  last reel stops, so the figure never gives the result away. A refused spin puts the stake straight
  back. While a spin is on its way or the reels are turning, nothing else on the page changes.
- **What it pays.** The machine's payout table drawn with its icons (three of each symbol, and two
  lucky symbols), each prize as a multiple and as money at the chosen stake, then: "This machine
  pays back 95.8% of what goes into it, over time. One spin in four pays something."
- **Below:** the player's last 10 spins on any machine (machine, the three symbols, staked, won),
  and "Big wins": the last 10 spins by anyone that paid 50 times the stake or more, as "Mounara won
  12 Gold 500 Silver on The Armoury".
- **States:** floor closed; machine closed; no characters; every character in the game; the chosen
  character went into the game (as in roulette: it stays chosen, Spin is disabled, and a note says
  to log out or pick another); ready; spinning; result.

### `/gm/slots` (GMs)

- The switch for the whole floor.
- For each machine: its own switch, its three stake sizes with the largest win they allow, its
  return as calculated from the strips, and totals for today and all time: spins, staked, paid out,
  the house's result, and the share actually paid back so far.
- The latest 20 spins by anyone: when, character, machine, symbols, staked, paid.
- Every change writes a row to the GM audit log. "Slots" is added to the GM menu.

### Menu

"Try Your Luck" becomes Roulette, Slots, Wheel of Fortune.

## Where things live

| What | Where |
|---|---|
| Spins (history, totals) | `TGAME_GSP.dbo.TPORTALSLOTSPIN` |
| Floor switch | `TPORTALSETTING`, key `slots_live` |
| Each machine's switch and stakes | `TPORTALSETTING`, keys `slots_<machine>_live` and `slots_<machine>_stakes` (for example `10,25,50`) |
| Table script | `apps/api/sql/TPORTALSLOTSPIN.sql` |
| API | `apps/api/src/slots/` (controller, service, repository) |
| Machines (strips, payout tables), the rules that read them, and the counting of every result | `packages/shared/src/slots.ts` |
| Player page, GM page | `apps/web/src/routes/_authed/slots.tsx`, `apps/web/src/routes/_authed/gm/slots.tsx` |
| Reels and cabinet | `apps/web/src/components/slots/` |

A spin row holds: ID, account, character ID and name, time, machine, the three stops, stake, payout
and the wallet afterwards (money in Bronze, as roulette stores it), and the prize as a multiple of
the stake, which is what "Big wins" reads.

Missing setting rows mean: the floor is closed, every machine is open, and stakes are the starting
ones. So after the SQL is applied a GM only has to open the floor.

**Shared with roulette.** Slots uses roulette's money step, its list of an account's wallets and its
character picker as they are. The code that lists an account's characters with their wallets
currently sits in roulette's repository; it moves to the shared games code so both games use one
copy. The way the roulette page holds the screen still while a spin is in flight is reused, not
copied.

## Rolling it out

- The SQL is additive: one new table. No setting rows are needed, and no game server restart.
- It is applied to `TGAME_GSP_TEST` only while building and rehearsing. Applying it to any other
  database waits for the owner's go-ahead, with `apply.sql` and `undo.sql` in
  `db_changes\2026-11-14-portal-slots` and an entry in the game changes ledger.
- After that the machines are visible but the floor is closed. A GM checks the stakes and opens it.
- Like roulette, it needs the index on `TCURRENTUSER (dwUserID)` on the live database.

## Testing

- **Unit:** every machine's return, pay rate and top prize odds, counted over every possible result
  and checked against the table above; the prize for chosen lines (three of a kind, two lucky, a
  near miss, the top prize); a spin never pays two prizes; every symbol on every strip has an icon;
  the stake checks; the reels' motion (starts where it was, ends on the given stops, never jumps).
- **HTTP:** login needed; a non-GM cannot reach the GM routes; a spin's answer and each refusal;
  a refused spin never reaches the money step.
- **Database** (against `TGAME_GSP_TEST`, rolled back): a win and a loss change the wallet by exactly
  the right amount; the floor closed is refused; the spin row matches what moved; totals per machine.
  The money step's own cases are already covered by roulette's tests.
- **Web:** picking a machine and a stake; the spin flow with the result shown only after the last
  reel stops; one press sends one spin; refusals leave the page truthful; closed floor and closed
  machine; the GM switches and stakes; the menu.
- No browser runs on the build machine, so the owner checks the look and the animation on a desktop
  and a phone.

## Left to the builder

- The exact reel strips, within the targets in the machines table. They are fixed in the code and
  pinned by the counting test.
- Each symbol's prize, as long as the top prize is as stated and the targets are met.
- The six icons for The Armoury and for Dragon's Hoard, from the game's own icons, within the
  themes above. The owner sees them on the page and can ask for others.
- Machine colours and the cabinet's look within the portal's existing style.
- Column names in the spin table and the machines' short names in the code.

## Not in this version

- A growing jackpot fed by a slice of every bet. (Added on 2026-11-15: see 2026-11-15-slots-jackpot-design.md.)
- Wild symbols, free spins, bonus rounds, more than one win line, hold and nudge.
- Automatic play, or holding a key down to keep spinning.
- In-game announcements of big wins.
- Sound.
- Daily limits on spins or losses, and any minimum character level.
- Machines that GMs can design or retune from the portal.
