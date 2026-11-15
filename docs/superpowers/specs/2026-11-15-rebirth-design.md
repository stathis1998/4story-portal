# Rebirth: back to level 1 with a lasting stat bonus

Date: 2026-11-15.
Status: built on feat/rebirth and feature/rebirth-bonus, not applied to live, not built.
Sections marked *(default)* are calls made while writing this, not
decisions by the owner; the three marked *(owner)* are.

## Why

A character that reaches level 90 has nothing left to climb. Rebirth lets it pay gold, start again
at level 1 and come back stronger each time. The achievements were built for this in advance: every
character award already carries a rebirth number (see `2026-11-13-tiered-achievements-design.md`).

## What it does

- A character at level 90 can be reborn from its page on the portal, while logged out.
- It costs gold. A GM sets the price; rebirth number N costs N times that price *(default)*.
- The character goes back to level 1 at the new-character start point.
- **Kept** *(owner)*: every item (bags, cabinet), the rest of the gold, pets, mounts, titles, guild,
  friends, mail and all lifetime combat statistics.
- **Reset**: level, EXP, skill points, learned skills, running buffs, the level freeze, and quests
  *(owner: the group levels by farming missions, but someone else may quest, so quests are cleared)*.
- **The bonus**: +2% to all six stats (STR, DEX, CON, INT, WIS, MEN) per rebirth, up to 10 rebirths
  *(default, both numbers GM-set)*. It is always on, survives death and needs no buff icon.
- **Gear must be taken off first** *(default)*. The game checks an item's level only when it is put
  on, so a reborn character still wearing level 90 gear would walk through the run. With the gear in
  the bags, the game's own check lets each piece back on as the level allows. Dropping this rule is
  one removed check, nothing else changes.
- The portal shows the rebirth number on the character list, the character page, the inspect page
  and the Hall of Fame's level ranking (rebirths first, then level). The rebirth is announced in
  world chat and in the portal news: `Mounara was reborn (rebirth 2)`.
- Character achievements become earnable and payable again (rules below).

Rebirth stays closed until a GM sets a price and opens it on `/gm/rebirth`.

### What the player sees

```
Rebirth                                   Rebirths: 1   Bonus: +2% all stats
  [x] Level 90
  [x] Logged out
  [ ] Nothing worn  (5 items still on)
  [x] 2,000 gold   (you have 3,412)
  Next: rebirth 2, +4% all stats                              [ Be reborn ]
```

The button opens a confirmation that lists what is reset and what is kept.

## How it works

1. **Portal, one SQL batch** built from the portal's configured table names, like
   `games/wallet-bet.ts`. It is not a stored procedure, because it touches the global database
   (`TCURRENTUSER`, `TALLCHARTABLE`), whose name differs between live and the test copies. In one
   transaction it locks the account's rows in `TCURRENTUSER`, checks the switch, ownership, offline,
   level 90, nothing in the equipment bag (inventory 254), the rebirth limit, the price the player
   was shown and the wallet, then writes everything in the table below and returns a code.
2. **Game database, two new tables.**
   - `TCHARREBIRTHTABLE (dwCharID PK, bRebirth, bStatBonus, dUpdate)`: the current state. The map
     server only reads `bStatBonus`, a percentage the portal works out from the GM settings. When a
     GM changes the percentage or the limit, every row is recalculated; a character in game picks
     it up at its next login.
   - `TCHARREBIRTHLOGTABLE`: one row per rebirth with the price paid, the date, the achievement
     baseline (below) and the announce flags.
3. **Map server, read and apply.** `bStatBonus` is read at character load and carried across channel
   changes exactly as `bFreezeLevel` is (`TCharStat.cpp`: `WriteCharStatFromDB`, `WrapCharStat`,
   `UnwrapCharStat`). It is applied in `CTPlayer::GetSTR` to `GetMEN`, where the pet bonus is
   already added. Attack power, attack and defence level and HP are derived from those stats in
   `Calc2ndAbility`. The client's character window shows the server's numbers
   (`OnCS_CHARSTATINFO_ACK`), so the bonus is visible with no client change. The Bow of War and
   Battle Royale servers ignore the bonus, since those modes put everyone on equal footing.

### What the batch writes

| Table | Change |
|---|---|
| `TCHARTABLE` | `bLevel` 1, `dwEXP` 0, `wSkillPoint` 200 (what a new character on this server starts with), HP and MP by `TCreateChar`'s formula, the start point of the character's country (spawn 15001, 15002 or 15003, position from `TSPAWNPOSCHART`), wallet minus the price |
| `TSKILLTABLE` | made equal to a new character's: class skills back to their `TSTARTSKILL` level, other learned skills removed, equip skills (kind 0) untouched, no gold payback |
| `THOTKEYTABLE` | slots pointing at a skill that is no longer learned are cleared, item slots stay |
| `TSKILLMAINTAINTABLE` | the character's rows deleted |
| `TQUESTTABLE`, `TQUESTTERMTABLE` | the character's rows deleted (a new character has none) |
| `TCHARLEVELFREEZETABLE` | the character's row deleted |
| `TALLCHARTABLE` (global database) | level and EXP (`TLogout` would also fix it at the next logout) |
| `TCHARREBIRTHTABLE`, `TCHARREBIRTHLOGTABLE` | count plus one, new bonus, log row |

Guild rank points need nothing: the code in `TSaveChar` that tied them to the level is commented out.

### Achievements

The awarder uses the character's rebirth number in place of the fixed first life. Each character
achievement gets one of three rebirth behaviours *(default)*:

- **Starts over by itself**: level, skills. The rebirth resets the number.
- **Counts from the rebirth**: kills, damage, healing, upgrades, lottery, gold looted and spent and
  the other counters. The portal stores each number in the log row at the moment of rebirth, and
  progress in the new life is the current number minus that baseline. Lifetime totals on the
  dashboard and `!cstat` are untouched.
- **Once per character**: what the character keeps, such as gear worn, gold held, titles,
  companions, friends and guild, and the records that can't be counted from a date (monster types,
  most kills of one monster, longest losing streak). Each level pays once, in whichever life it is
  reached. Paying these again would hand the reward straight back.

The baseline must be read fresh for that character, not from the one-minute stats cache. The
awarder leaves a character alone for two minutes after its rebirth, so numbers read just before it
can never be paid in the new life.

## Approaches considered

- **Chosen: the portal resets the character while it is logged out, the map server only reads a
  bonus.** The reset is one transaction that can be tested against the test databases, the rules
  can change without a server build, and the server change is about as small as the level freeze.
- *In game, by chat command or NPC.* No logout needed, but the map server would have to reset a
  live character (level, skills, quests, position, the world server's copy of the level), and every
  rule change would need a rebuild and restart.
- *No server change: the bonus as a long-running buff or a bound item.* Buffs are stored with a
  remaining time, can be removed, and need client chart files for a name and icon. An item can be
  taken off or lost.

## Constraints

- A map server built with this change needs the tables first, as with the level freeze. The same
  servers that were rebuilt for the level freeze must be rebuilt together, since they share the
  packet. The owner stops the servers and rebuilds; nothing is built while `TMapSvr` runs.
- Open rebirth on the portal only after the rebuilt server is running, or characters are reset and
  get no bonus until it is.
- Database scripts go in `Server/db_changes/2026-11-15-rebirth/` with an undo, the two new tables
  join the season reset list, and the change is entered in the game changes ledger.
- Tests run against `TGAME_GSP_TEST` and `TGLOBAL_GSP_TEST`, never the databases named in `.env`.

## Settled while planning

- The soul lottery bar is not stored in the database, so there is nothing to reset.
- A summoner's saved recall monster (`TRECALLMONTABLE`) is left alone: deleting it could cost the
  class its starting pet. It keeps its old level until it is summoned again.
- The four settings are rows in `TPORTALSETTING`: switch, price, percent per rebirth, limit.

## Not checked

- Balance. +2% per rebirth and a limit of 10 have not been tried in game.
- Magic attack and MP were assumed to follow the same stat formulas as the ones read.
- How a saved level 90 recall monster behaves beside a level 1 owner.

## Not in this version

- Rebirth from inside the game.
- A title, name colour or icon in the client.
- Other bonuses per rebirth, such as EXP or drop rate.
