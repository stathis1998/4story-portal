# Player dashboard

Date: 2026-11-01. Status: approved design.

## 1. Goal

When players log in to the portal, give them something fun to look at: their own progress, and a friendly competition with the other players. The community is small (5 accounts, 14 characters on 2026-11-01), so personal progress and rivalry between friends matter more than large leaderboards.

**Decisions made with the user:**
- Only data the game already stores. No game server changes.
- Everyone is ranked by default, GMs included. A GM can hide GM accounts from the page.
- Anything the portal stores goes in its own SQLite file, not the game databases and not JSON.

**Out of scope:** daily snapshots, weekly recap and history charts; combat and luck counters; gold in rankings; moving `gm-locations.json` to SQLite.

## 2. Facts from the game

Read from the databases on 2026-11-01 and the game source. The portal cannot change these.

- **Characters:** `TGAME_GSP.TCHARTABLE`, live where `bDelete = 0`. `TGLOBAL_GSP.TALLCHARTABLE` carries `Ban` for the same `dwCharID`.
- **Accounts:** `TACCOUNT_PW` maps `dwUserID` to `szUserID`. A GM is an account in `GM_USERNAMES`.
- **Experience:** `dwEXP` is cumulative. `TLEVELCHART.dwEXP` for level L is what ends level L, so progress is `(dwEXP - chart[L-1]) / (chart[L] - chart[L-1])`. Every live character fits this.
- **Sessions:** `TGLOBAL_GSP.TLOG` has one row per session (`dwCharID`, `timeLOGIN`, `timeLOGOUT`). It holds about 700,000 rows back to 2013, and its only index is on `dwKEY`. A full scan takes about 100 ms. Times are server local, and the driver returns them as if they were UTC, so `getUTC*` reads the wall clock (as `characters.mapper.ts` relies on).
- **Old rows:** sessions from before a character was created don't belong to it. `timeLOGIN` is cut to the minute, so a session in the creation minute starts up to 59 seconds before `dCreateDate`.
- **Idle sessions:** `dwPlayTime` is seconds and agrees with `TLOG`, but one character's 394 hours are mostly one 15-day login. Counting at most 12 hours per session gives 35 hours, against 29, 27 and 13 for the next characters.
- **Equipped gear:** `TITEMTABLE` where `bStorageType = 0`, `bOwnerType = 0`, `dwStorageID = 254` (`INVEN_EQUIP`) and `dwOwnerID` is the character. `bItemID` is the slot (`ES_*` in `NetCode.h`), `bLevel` is the upgrade level, and `wItemID` joins `TITEMCHART.szNAME`.
- **Titles:** `TTITLETABLE` (`dwCharID`, `wTitleID`), names in `TTITLECHART.strTitle`, a `text` column. Title 0 is "No title", which leaves 110.
- **Companions:** `TCOMPANIONTABLE` (`dwCharID`, `bSlot`, `dwMonID`, `bLevel`, `strName`).
- **Empty today:** PvP records and PvP points are all 0, so they aren't used.
- **Duels:** `TDUELSCORETABLE` has wins and losses per opponent class. `TDuelScore` takes losses first but saves them to the right columns, and the totals agree with `TDUELCHARTABLE`.
- **Friends and guilds:** `TFRIENDTABLE` (`dwCharID`, `dwFriendID`), `TGUILDMEMBERTABLE` (`dwCharID`), and `TGUILDTABLE.dwChief` for the leader.
- **Not recorded:** deaths, failed upgrades, destroyed items and kills. `LogUserDie`, `LogItemUpgrade` and the others have their bodies commented out in `TMapSvr/UdpSocket.cpp`. `TQUESTTABLE` holds too little to count quests: a level 93 character has no rows.

## 3. Definitions

All of these live in one place as plain functions.

- **Counted session:** from `timeLOGIN` to the earlier of `timeLOGOUT` and 12 hours later. Sessions with no logout, or a logout not after the login, don't count.
- **Hours played:** the sum of counted sessions.
- **Longest session:** the longest counted session, so at most 12 hours.
- **Days played:** every calendar date a counted session touches. A session crossing midnight counts both days.
- **Streak:** consecutive days played. The current streak is the run ending today or yesterday, otherwise 0.
- **Night owl session:** a counted session starting between 00:00 and 04:59.
- **Character age:** days since `dCreateDate`.
- **Best item:** the highest upgrade level among equipped items.
- **Companion level:** the highest `bLevel` among a character's companions.

Account stats combine that account's characters: hours add up, days and streaks use the combined days, and the others use the best character.

### Badges

Earned per account, using the account stats, and grouped into categories.

| Category | ID | Name | Earned at |
|---|---|---|---|
| Progress | `level-10`, `25`, `50`, `75`, `90`, `100`, `125` | Level N | Any character at that level |
| Progress | `level-50-x3` | Three of a Kind | Three characters at level 50 |
| Playtime | `hours-10`, `50`, `100`, `500` | N Hours | Account hours played |
| Playtime | `days-7`, `30`, `100` | N Days Played | Account days played |
| Playtime | `streak-3`, `7`, `30` | N Day Streak | Longest account streak |
| Playtime | `night-owl` | Night Owl | 10 sessions starting 00:00 to 04:59 |
| Playtime | `early-bird` | Early Bird | 10 sessions starting 05:00 to 07:59 |
| Playtime | `weekend-warrior` | Weekend Warrior | 10 sessions starting on a Saturday or Sunday |
| Playtime | `marathon` | Marathon | One counted session of 8 hours. Idle time counts, because the game can't tell it apart |
| Playtime | `veteran` | Veteran | A character at least 365 days old |
| Gear | `upgrade-10`, `15`, `20` | +N Item | Best item |
| Gear | `geared` | Fully Geared | One character with main weapon, head, body, pants, feet and hands equipped (slots 0, 3, 5, 6, 7, 8) |
| Gear | `jeweller` | Fully Jewelled | One character with neck, both rings and both earrings equipped (slots 9 to 13) |
| Gear | `dressed-up` | Dressed Up | Any costume item equipped (slots 15 to 18) |
| Collection | `titles-5`, `10`, `25` | N Titles | Any character with that many titles |
| Collection | `companion-first` | New Best Friend | Any character with a companion |
| Collection | `companion-20` | Beast Master | Any character with a level 20 companion |
| Collection | `companion-5` | Full Pack | Any character with 5 companions |
| Collection | `classes-3`, `classes-6` | Jack of Trades, Master of All | That many different classes on the account |
| Collection | `races-3` | World Traveller | All 3 races on the account |
| Collection | `wealth-100`, `1000`, `10000` | Pocket Money, Treasure Hoard, Dragon Hoard | Any character with that much gold |
| Social | `friends-1`, `friends-5` | First Friend, Good Company | Any character with that many friends who still exist |
| Social | `guild-member`, `guild-leader` | Guild Member, Guild Leader | Any character in, or leading, a guild |
| Social | `duels-1`, `10`, `50` | First Blood, Duellist, Champion | Duel wins added up across the account |

**Coming soon:** shown so players can see what's planned, but nobody can earn them, because the game doesn't record them. They don't count in any total, have no rarity line, and are never stored. To make one real, the game has to record it first.

| Category | ID | Name | What it will need |
|---|---|---|---|
| Progress | `quests-10`, `100`, `500` | Helping Hand, Adventurer, Living Legend | Quests finished |
| Combat | `kills-100`, `1000`, `10000` | Hunter, Slayer, Exterminator | Monsters defeated |
| Combat | `bosses-1`, `10` | Giant Killer, Boss Slayer | Bosses defeated |
| Misfortune | `deaths-1`, `100`, `1000` | Ouch, Back Again, Death Is a Habit | Deaths |
| Misfortune | `failed-upgrades-1`, `10`, `100` | Bad Luck, Cursed Anvil, Why Do I Keep Trying | Failed upgrades |
| Misfortune | `destroyed-1`, `10` | Gone, Heartbreak | Items destroyed by a failed upgrade |

**Rarity:** "held by H of T players", counted in accounts. T is accounts with a live character that isn't banned. Hidden GM accounts count in neither.

**Dates:** the first time the portal sees an account hold a badge, it stores the date. Badges already held the first time that badge exists store no date, and show none, so adding a badge later doesn't make it look newly earned. A badge seen in the last 7 days is **New**. The account with the earliest date, when no holder has a blank date, is **First to earn** it.

### Hall of Fame

Categories, by character unless noted: highest level, most hours, longest streak, best item, most titles, top companion, most achievements (by account, shown under that account's highest level character).

- Banned characters and zero values aren't listed. Ties share a place (1, 1, 3), and ties sort by name.
- Each category shows places 1 to 3, at most 5 rows.
- Your best character in the category is marked. If it isn't listed, a line below shows your place.
- Account names and gold never appear.

## 4. Web

Header gains links to **Characters** and **Hall of Fame**. Stats note: "Updated when a character's session is saved."

- **`/characters`** (where login lands): event banner, account summary (hours, days played, current streak), activity calendar, achievements with one tab per category (such as "Playtime 6/15", or just the name when all of them are coming soon), and the existing cards with a level progress bar and hours, linking to the character page. If the stats fail to load, the cards still show, with a short notice.
- **`/characters/$id`**: level progress, equipped gear with icons and upgrade level, companions, titles collected out of the total, records, and your place in each category. Another account's character is a 404 message.
- **`/hall-of-fame`**: the categories above. GMs also see a **Hide GM accounts** switch. A hidden GM sees "GM, not ranked".

The activity calendar is a 53-week grid with four shades, each with the date and minutes as its accessible label.

The event banner reads "EXP +100%, ends in 2h", adding the map for a drop event on one map. It shows nothing when no event runs or the control server is down.

## 5. API

| Route | Who | Returns |
|---|---|---|
| `GET /api/me/overview` | Logged in | Account stats, calendar, badges, per-character stats |
| `GET /api/characters/:id/profile` | Owner, otherwise 404 | Gear, companions, titles, records, rankings |
| `GET /api/hall-of-fame` | Logged in | Categories, your place, and for GMs the switch state |
| `GET /api/events/active` | Logged in | Running percentage events: type, bonus, map name, end time, server clock |
| `PUT /api/gm/hall-of-fame/settings` | GM | Sets `{ hideGms }`, 30 writes a minute |

- `StatsRepository` reads all rows in one call, read only. `StatsService` keeps the computed result in memory for 60 seconds and shares one load between concurrent requests. The hide switch is applied per request, so it works at once.
- Active events are kept for 30 seconds, because the control connection handles one request at a time. A failure gives an empty list. For a daily event, the end shown is today's window end.
- `:id` that isn't a number from 1 to 2147483647 is a 400.

## 6. SQLite store

`apps/api/data/portal.sqlite`, or `PORTAL_DB_FILE`. The setting is optional, so an existing `.env` keeps working. It uses Node's `node:sqlite`, behind one class, `PortalStore`.

```sql
settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)
setting_changes(id INTEGER PRIMARY KEY, key TEXT, value TEXT, changed_by TEXT, changed_at TEXT)
badge_unlocks(user_id INTEGER, badge_id TEXT, first_seen TEXT NULL, PRIMARY KEY (user_id, badge_id))
badge_baselines(badge_id TEXT PRIMARY KEY)
```

- Schema changes run from a numbered list, tracked by `PRAGMA user_version`.
- A badge missing from `badge_baselines` is having its first recording: holders get a blank date, then it's added. Later ones store the date. A file already in use starts with the original 21 badges in there.
- Hide changes are recorded in `setting_changes`, not `TMANAGERLOG`.
- The game databases are only read by this feature.

### Failure behaviour

| Failure | Result |
|---|---|
| SQLite can't open or write | Logged. Stats still work, with no dates and nobody hidden. The switch gets a 503: `Settings could not be saved` |
| Control server down | No event banner |
| Game database down | Stats routes give a 500, and the page shows a retry message |
| Character with no sessions | Zeros |
| Item with no chart row | `Item #id` |
| No level chart row | No progress bar |

## 7. Testing

`npm test` touches no real database or server.

- **Rules:** cap, midnight crossing, streaks ending today, yesterday and earlier, ties, badges, old rows.
- **Store:** an in-memory database, plus a file reopened to prove settings last, and a path that can't be opened.
- **HTTP:** guards, ownership, hide switch, caching, failures, no account names or gold in the Hall of Fame body.
- **Web:** page tests like the GM ones.
- **Database:** read-only repository tests against the `_TEST` copies.
- **Browser:** the built app in headless Edge with the real API on separate ports and the `_TEST` databases.
