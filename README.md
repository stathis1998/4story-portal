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
