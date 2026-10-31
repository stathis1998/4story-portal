# 4Story Portal

Web portal for a private 4Story server: register a game account, log in, and see your characters.

- `apps/web`: React + Vite frontend
- `apps/api`: NestJS backend that talks to the game's SQL Server
- `packages/shared`: Zod schemas and types used by both

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
