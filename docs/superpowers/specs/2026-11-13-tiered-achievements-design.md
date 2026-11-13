# Tiered achievements with rewards, mail, announcements and news

Date: 2026-11-13. Replaces the badges section of `2026-11-01-player-dashboard-design.md`.

## Why

The 58 badges were added quickly. They were recalculated only when someone opened a page, stored no
progress, could be lost again (gold held, worn gear) and paid nothing. The group wanted goals that
build on each other, a reward for reaching them, and the rest of the server hearing about it.

## What it does

- **Achievements have levels.** About 42 achievements, each a number worked out from an account's
  stats and up to five thresholds. `Slayer` is monsters defeated at 1,000 / 10,000 / 50,000 / 250,000 /
  1,000,000. They are per account, so alts can't repeat the early levels.
- **One block per achievement.** The block shows `Level 2/5`, a bar toward the next level and what
  the next level asks for and pays. Opening it lists every level.
- **Each level can pay a reward:** gold, silver, copper and up to three items, set by a GM on
  `/gm/achievements`. None are set in code.
- **Reaching a level sends a letter** from `Achievements` titled `Achievement: Slayer III`, with the
  reward attached when there is one. It goes to the account's online character, or the one played last.
- **It is announced in game** as an Operator line in world chat: `Mounara completed Slayer III: Defeat
  50,000 monsters`.
- **The same line is the portal's news.** `/characters` opens with the latest eight.
- **A level, once awarded, stays.** It still shows as done when the number behind it drops.

## The Go live switch

Rewards start empty and the group wanted progress made before launch to be paid. So nothing is
awarded, mailed or announced until a GM turns the switch on. Until then players see their levels and
progress. When it goes on, every level already reached is awarded, 20 a minute, lowest levels first.
After that, changing a reward only affects levels reached later.

## How it works

1. `AchievementAwarder` runs once a minute while the switch is on. It skips the run when nobody has
   been online for 10 minutes, unless it still has a backlog.
2. It reads the same cached stats the pages use, compares each account with the thresholds, and
   leaves out the levels already in `TPORTALACHIEVEMENTTABLE`.
3. For each level due it calls `TPortalAchievementAward`. In one transaction that procedure checks
   the switch is on and the level hasn't been awarded, looks up the level's reward, sends the letter
   through `TPortalGmPost` and inserts the award row. A level is never paid twice and never recorded
   without its letter. An award that fails is logged and the rest carry on.
4. It then announces the awards still waiting, through the control server connection
   (`CT_ANNOUNCEMENT_REQ`). Each one is claimed in the database before it is sent, so it is said
   once. If the control server is down they wait; after 10 minutes they are skipped.

The switch, the rewards and the awards all live in the game database, so every portal process that
points at one database agrees about them. A second copy of the portal, run from a worktree against
the live database, pays the same rewards and can't announce twice. Switching off stops the batch in
progress: the procedure refuses the next award.

## Approaches considered

- **Chosen: the portal detects, the game database records, existing mail and control paths deliver.**
  No game server rebuild.
- *Award record in the portal's SQLite file.* The record and the letter would be in two stores, so a
  crash between them means a double or a missing payout.
- *Rewards and the switch in the portal's SQLite file* (built first, then changed after review). A
  second portal process has its own file, so it could award real levels with its own, empty rewards,
  and the game database would record them as paid for good. An unreadable file would do the same.
- *World server polls a queue table and announces (C++).* Instant alerts, but a rebuild and restart
  for something the control connection already does.

## Where things live

| What | Where |
|---|---|
| Achievements and thresholds | `apps/api/src/achievements/achievement-rules.ts` |
| Awards (also the news feed) | `TGAME_GSP.dbo.TPORTALACHIEVEMENTTABLE`, emptied by the season reset |
| Rewards | `TGAME_GSP.dbo.TPORTALACHIEVEMENTREWARD`, kept through the season reset |
| The switch | `TGAME_GSP.dbo.TPORTALSETTING`, key `achievements_live`, kept through the season reset |
| Award procedure | `apps/api/sql/TPortalAchievementAward.sql` |
| Types shared with the web | `packages/shared/src/achievements.ts` |

Because the switch is kept through the season reset, a new season starts awarding from its first day.

An achievement's ID is stored with every award and must never change. Thresholds can change: raising
one doesn't take an awarded level back, and lowering one pays whoever is now past it.

## Not in this version

- New server-side counters: deaths, boss kills, quests completed, crafts, kills in a party, rare
  drops, refines, revives, Crystal Game wins. Each needs a map server change.
- PvP achievements. Everyone is in one faction, so nobody could earn them.
- Editing thresholds on the portal.
- Rewards other than gold and items, such as custom titles.
