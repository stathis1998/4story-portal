# Rebirth extras: EXP and gold bonuses, and a mailed reward per rebirth

Date: 2026-11-16.
Status: built on `feat/rebirth-extras` (portal) and `feature/rebirth-extras` (Server). Not applied to `TGAME_GSP`, not merged, not built.
Builds on `2026-11-15-rebirth-design.md` (rebirth itself, on `main` and on Server `master` `9952504`).
Calls marked *(owner)* are the owner's; the rest were proposed and approved as a whole on 2026-11-16.

## Why

Rebirth only raises the six stats, which makes it one-dimensional: a mage's only gain is damage. The owner
wants each rebirth to also make the next climb faster, help pay for the next rebirth, and hand out rewards
the GMs choose.

## What it does

1. **EXP bonus** *(owner)*: a percentage per rebirth, set on `/gm/rebirth`. A reborn character gains that much
   more EXP from every source while it is still climbing.
2. **Monster gold bonus** *(owner)*: a percentage per rebirth, set on `/gm/rebirth`. A reborn character receives
   that much more gold each time it takes gold from a monster.
3. **A reward per rebirth number** *(owner)*: on `/gm/rebirth` a GM attaches gold, silver, copper and up to three
   items (each with a count) to rebirth 1, rebirth 2, and so on. When a character completes that rebirth,
   the reward arrives as an in-game letter *(owner: by mail)*.

The stat bonus is unchanged. Both new bonuses count up to the same rebirth limit as the stat bonus:
`min(rebirths, limit) × percent`, exactly like `rebirthBonus` today.

### What the GM sees on `/gm/rebirth`

```
Settings
  Rebirth open            [x]
  Price per rebirth       [ 1000 ] Gold     (rebirth N costs N × price)
  Stats per rebirth       [   5  ] %
  EXP per rebirth         [  10  ] %        0 = off
  Monster gold per rebirth[   5  ] %        0 = off
  Limit                   [  10  ] rebirths
                                                        [ Save ]
Rewards
  Rebirth 1   2 Gold, Upgrade Scroll x3                 [ Edit ]
  Rebirth 2   nothing                                   [ Edit ]
  ...
  Rebirth 10  Golden Necklace of Antiquity x1           [ Edit ]
```

One row per rebirth number from 1 to the current limit. Edit opens the existing `RewardEditor`
(`apps/web/src/components/gm/RewardEditor.tsx`, the one achievement rewards use). A reward saved for a rebirth
number above a later, lower limit is kept but cannot be reached; the page lists it under the limit as
"beyond the limit".

### What the player sees

- The character page's rebirth section shows all three bonuses, now and after the next rebirth:
  `Rebirths: 1   Stats +5%   EXP +10%   Monster gold +5%`, and the next rebirth's reward, if one is set
  (`Reward: 2 Gold, Upgrade Scroll x3`), using the same reward wording the achievements page uses.
- The confirmation lists the reward among what the character gets.
- After a rebirth, a letter from `Rebirth` titled `Rebirth 2 reward` waits at the next login. A rebirth number with
  no reward set sends no letter.

## How it works

### Database (`TGAME_GSP`)

- `TCHARREBIRTHTABLE` gains `bExpBonus TINYINT NOT NULL DEFAULT 0` and `bGoldBonus TINYINT NOT NULL DEFAULT 0`,
  each a percentage, each with a check of at most 250. The portal works them out from the settings, as it does
  `bStatBonus`, and recalculates every row when a GM saves the settings (the existing `saveSettings` UPDATE gains
  two columns).
- New table `TPORTALREBIRTHREWARD`: `bRebirth TINYINT` primary key (1 to 20), then the same columns as
  `TPORTALACHIEVEMENTREWARD` (`dwGold`, `dwSilver`, `dwCooper`, `wItemID1..3`, `bCount1..3`, `szUpdatedBy`,
  `dUpdated`). No row means no reward. Saving an empty reward deletes the row, as for achievements. The table is
  kept through the season reset, like the achievement rewards.
- `TCHARREBIRTHLOGTABLE` gains `dwPostID INT NOT NULL DEFAULT 0`: the letter sent with that rebirth, 0 for none.
- Two `TPORTALSETTING` rows: `rebirth_exp_percent` and `rebirth_gold_percent`. A database with neither row reads
  0 for both, so the bonuses stay off until a GM saves them.
- Scripts in `Server/db_changes/2026-11-16-rebirth-extras/` (`apply.sql`, `undo.sql`), the portal's
  `apps/api/sql/` files updated to match, and a ledger entry.

### Portal

- **Settings** (`packages/shared/src/rebirth.ts`): `RebirthSettings` gains `expPercent` and `goldPercent`, each an
  integer from 0 to 25, with `expPercent × limit ≤ 250` and `goldPercent × limit ≤ 250` so the stored value fits.
  Defaults 0.
- **Rewards API**: `GET gm/rebirth` also returns every saved reward; `PUT gm/rebirth/rewards/:rebirth` saves one,
  validated with the same item checks as achievement rewards (item exists, count within its stack, at most
  three items). Item and money validation reuses what achievement rewards use.
- **The rebirth batch** (`rebirth-sql.ts`): after the reset succeeds and inside the same transaction, it reads
  `TPORTALREBIRTHREWARD` for the new rebirth number and, when the row pays anything, calls the GM mail
  procedure (`db.tables.mailProcedure`, `TPortalGmPost`) with sender `Rebirth`, title `Rebirth N reward` and a
  short message. The post ID goes in the log row. If the letter fails, the whole rebirth rolls back. The new
  `bExpBonus` and `bGoldBonus` are written with `bStatBonus`.
- **State for the page**: `RebirthState` gains the current and next EXP and gold bonuses and the next rebirth's
  reward.
- **GM page**: two number fields and the rewards list above.

### Map server (`TMapSvr`)

Same pattern as the stat bonus (Server commit `ee7797a`):

- `CTBLCharRebirth` also reads `bExpBonus` and `bGoldBonus`. `WriteCharStatFromDB`, `WrapCharStat` and
  `UnwrapCharStat` carry both after `bRebirthBonus`, so the char-stat packet grows by two bytes. `TMapSvr`,
  `TBoWSvr` and `TBRSvr` share that packet and are rebuilt together.
- **EXP**: in `CTPlayer::GainExp`, the gain (including the vitality bonus) is raised by `bExpBonus` percent,
  only when the character is below its level cap. At the cap the game turns EXP into gold; that conversion
  gets no EXP bonus, so the gold bonus stays the only gold lever.
- **Gold**: wherever a player is paid monster gold in `MonMoneyTake` (looter, each party member near the kill,
  auto-loot), the amount paid to that player is raised by that player's `bGoldBonus` percent. A party member on
  another map server is paid through `SendMW_TAKEMONMONEY_ACK`; the bonus is applied where that player is held
  in memory, so each player gets their own bonus. `CHARCOUNTER_MONMONEY` counts what was actually paid.
- Money math is done in 64 bits and capped at `0xFFFFFFFF`, as the party bonus code already does (see the
  DWORD price wraparound noted in the game changes ledger).
- Bow of War and Battle Royale ignore both bonuses, as they ignore the stat bonus.

## Approaches considered

- **Chosen: the portal works out each character's bonus and the map server only reads it**, as for stats. Rules
  change on the GM page without a rebuild; the server change is small and repeats a reviewed pattern.
- *The map server reads the GM settings itself.* Every map server would need the settings and the limit rule,
  and a GM change would need the servers to reload.
- *Rewards sent later by a background sender, like the achievement awarder.* Needs its own retry and
  bookkeeping. Sending inside the rebirth batch is atomic: a rebirth and its letter happen together or not at
  all, and the character is offline, so the letter is simply waiting at login.

## Constraints

- `apply.sql` before both the new portal code (it reads the new columns and table) and the new map servers (they
  select the new columns). The old map server keeps working with the new columns.
- A character in game keeps its old bonuses until its next login, as with stats.
- Nothing is built while `TMapSvr` runs; the owner stops it, or asks Claude to do the stop and rebuild.
- Tests run against `TGAME_GSP_TEST` / `TGLOBAL_GSP_TEST`, never the databases in `.env`.

## Not in this version

- A reward for something other than a rebirth number (for example every rebirth).
- More than three items in one reward. A GM who needs more can send a second letter from GM mail.
- Item drop rate and upgrade chance bonuses (discussed and set aside: they change the item economy).

## Settled after the builder check (Claude's calls)

- **EXP crossing the cap.** When one gain carries a character over its level cap, only the part spent on levels
  gets the EXP bonus; the overflow that the game turns into gold is the base amount. `GainExp`'s overflow branch
  must apply this explicitly.
- **Soul lottery bar.** It keeps filling from the base EXP gain, not the bonused one. The lottery is part of the
  item economy, which this version leaves alone.
- **Rewards are not back-filled.** A rebirth pays the reward saved for its number at the moment it happens. Setting
  or changing a reward later sends nothing to characters already past that number, and the reward is not
  checked against what the confirmation showed.
- **Letter items survive logout.** `TLogout` deletes a character's `TITEMTABLE` rows only where
  `bStorageType <> 2` before copying `TTEMPITEMTABLE` back, so items in a letter (storage type 2, written by
  `TPortalGmPost`) are untouched even if the rebirth lands just before that copy. Checked on `TGAME_GSP_TEST`.
- **A failed letter fails the rebirth.** `TPortalGmPost` returns 0 when it writes nothing; the batch turns that into
  an error so the whole rebirth rolls back.

## Left to the builder

- Exact message text of the letter, and the page wording beyond the sketches above.
- How the GM page lays out the rewards list on a phone.
