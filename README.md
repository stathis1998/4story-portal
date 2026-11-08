# 4Story Portal

Web portal for a private 4Story server: register a game account, log in, and see your characters.

- `apps/web`: React + Vite frontend
- `apps/api`: NestJS backend that talks to the game's SQL Server
- `packages/shared`: Zod schemas and types used by both

## Setup

Requirements: Node 24 (24.15+ recommended by the Nest CLI), SQL Server instance `localhost\FOURSTORY` with TCP on port 1433.

1. Create the test databases (see below) if they do not exist yet.
2. Copy `.env.example` to `.env` and fill in:
   - `DB_PASSWORD`: the `sa` password the game servers use.
   - `JWT_SECRET`: a random string of at least 32 characters, for example the output of
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Install and start:

   ```sh
   npm install
   npm run dev
   ```

4. Open http://localhost:5173. The API runs on port 3000 behind Vite's `/api` proxy.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Web and API in watch mode |
| `npm run build` | Builds shared, API and web |
| `npm run lint` | ESLint (web), oxlint (API) and type checks |
| `npm test` | All unit and HTTP tests. Never touches a database. |
| `npm run test:db` | Real-database tests against the `_TEST` copies, always rolled back. Refuses to run unless both database names end in `_TEST`. |

## Going live

The portal writes accounts only to the databases named in `.env`. To let players register real game accounts, change these two lines and restart the API:

```sh
DB_GLOBAL_NAME=TGLOBAL_GSP
DB_GAME_NAME=TGAME_GSP
```

## GM tools

Accounts listed in `GM_USERNAMES` get a teleport tool that sends move commands to the game's TControlSvr, a logins tool for players stuck after a server was closed without `/exit`, a vendor tool for editing what NPC shops sell and what it costs, and an events tool for running EXP, drop and other bonus events.

- Keep TControlSvr's port 3616 firewalled to localhost.
- The portal logs in to TControlSvr as the `TMANAGER` account `portal` (authority 3), using `CONTROL_USER` and `CONTROL_PASSWORD` from `.env`. TControlSvr checks logins against the live `TGLOBAL_GSP`, so the account must exist there. Create it, or reset its password after changing `CONTROL_PASSWORD`, with:

  ```sh
  PW=$(grep '^CONTROL_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')
  sqlcmd -S "localhost\FOURSTORY" -E -C -b -i scripts/db/create-portal-manager.sql -v DB=TGLOBAL_GSP ALLOW_LIVE=1 PORTAL_PASSWORD="$PW"
  ```

  It prints `Inserted TMANAGER portal in TGLOBAL_GSP` (or `Updated …` when the account exists). Then restart TControlSvr; the API reconnects by itself within about 30 seconds. `DB`, `ALLOW_LIVE` and `PORTAL_PASSWORD` are required, and a non-`_TEST` database is refused unless `ALLOW_LIVE=1`.
- The online player list and the audit come from `DB_GLOBAL_NAME` / `DB_GAME_NAME`. Point them at the databases the game servers use (see "Going live"); the `_TEST` copies have no one online.
- List only existing accounts in `GM_USERNAMES`.
- Map names and the destination search come from the game client's `TRegion.tcd` and `TPortal.tcd`, because the database has no names. They are committed in `apps/api/src/gm/game-places.generated.ts`, so the API does not need the client. After a client update, set `GAME_TCD_DIR` in `.env` to the client's `Tcd` folder, run `npm run import:places -w apps/api`, and restart the API. Maps with no name in those files show as "Map 600".
- TControlSvr must be running and connected to the world server for teleports to arrive. The portal can only report "sent".
- The Logins page lists `TCURRENTUSER`. Closing a server without `/exit` leaves rows behind, and the player then gets "An attempt was made to connect to the ID" at every login. "Clear login" kicks the character through TControlSvr and waits up to 5 seconds: a real session logs out normally and removes its own row, and a row still there is deleted. Clears are written to `TMANAGERLOG` as `CLEARLOGIN`.
- The Vendors page (`/gm/vendors`) lists shop NPCs (`bType` 2 pays money, 21 pays PvP points), edits each vendor's stock, and sets item prices. A price belongs to the item, not the vendor, so changing it changes it at every vendor using that currency, and changing the money price also changes what players get for selling it back (a quarter of the price). Adding and removing items affects only the one vendor.
- An item whose full stack would overflow can't be added to a shop until its price is lowered. The game multiplies price by count in 32 bits, so such a price wraps around and buying a stack costs almost nothing. Stock already priced like this is flagged on the page.
- Edits are written to the database at once but reach players only after every `TMapSvr` restarts.
- The client's sell-price tooltip keeps showing the old value until `TItem.tcd` changes, while the server pays the new one.
- Item and NPC icons and the item lookup come from the client's data files. They are committed in `apps/web/public/game-icons/` and `apps/api/src/gm/game-icons.generated.ts`, so the API does not need the client. After a client update, set `GAME_TCD_DIR`, run `npm run import:icons -w apps/api`, and restart the API. The parent of `GAME_TCD_DIR` must hold `TClientCmd.tif`, `Index/` and `Data/`.
- Writes are audited in `TMANAGERLOG` as `VENDORADD`, `VENDORDEL` and `ITEMPRICE`.
- The Events page (`/gm/events`) runs bonus events through TControlSvr, the way Happy does: EXP, item, magic and money drops, refine, refine transfer, item, magic and rare magic upgrades, and gamble option. Special events made in Happy (cash shop sale, monster spawn and regen, lottery, gift time) can be seen and stopped here, not edited. The server starts and stops events on schedule within seconds, with no restart.
- An event's bonus is +N%, so 100 means double. Times are the server's clock. The portal's `TMANAGER` row needs `bAuthority` 3 or better to list events, and the API must run on the same machine as TControlSvr so their timezones match.
- The server has no pause: stopping an event removes it. Saving a running event restarts it, so players see the start message again and the bonus drops out for a second or two. To change an event's type, stop it and create a new one, because the server would leave the old bonus on.
- Finished events delete themselves from `TEVENTCHART`, so `TMANAGERLOG` is the only history, as `EVENT`. The list can't load while TControlSvr is down, and a bonus stays on past its end until TControlSvr comes back.

## Player dashboard

Logged-in players see their own progress and how they compare, all worked out from data the game already stores:

- `/characters`: an event banner while one runs, hours and streaks, an activity calendar, badges with their rarity, and a level bar on each card.
- `/characters/:id`: equipped gear, companions, titles, records and rankings, for your own characters only.
- `/hall-of-fame`: the top three in each category, with your place. Gold and account names never appear. GMs get a **Hide GM accounts** switch, which removes GM accounts from the rankings and rarity for everyone.
- `/leaderboard`: every character ranked by damage dealt to monsters, monsters killed and gold spent on NPCs and fees, from the counters `TMapSvr` saves in `TCHARSTATTABLE` and `TCHARCOUNTERTABLE`. It follows the same rules as the Hall of Fame: no gold balances or account names, banned characters left out, and the **Hide GM accounts** switch applies.
- `/shop`: a joke Gold store. The Buy buttons only show a funny message; nothing is charged or given.

At most 12 hours of one session count, so a character left logged in for days doesn't bury everyone else. Stats change when the game saves a session, and the API reads them at most once a minute.

The game databases are only read for this. The portal's own data, the hide switch with its change history and the date each badge was first seen, is in a SQLite file at `PORTAL_DB_FILE` (by default `apps/api/data/portal.sqlite`). To back it up, copy the file. It uses Node's built-in `node:sqlite`, so Node 24 prints an "experimental" warning at startup. If the file can't be used, stats still work, with no badge dates and nobody hidden.

## Test databases

Development and tests never write to the real game databases (`TGLOBAL_GSP`, `TGAME_GSP`). They use copies:

| Real | Copy |
|---|---|
| `TGLOBAL_GSP` | `TGLOBAL_GSP_TEST` |
| `TGAME_GSP` | `TGAME_GSP_TEST` |

Create or refresh the copies (replaces any existing `_TEST` databases with the current real data):

```sh
sqlcmd -S "localhost\FOURSTORY" -E -C -b -i scripts/db/create-test-copies.sql
```

The script only reads the real databases (a copy-only backup). During development, `.env` must point `DB_GLOBAL_NAME` and `DB_GAME_NAME` at the `_TEST` names.
