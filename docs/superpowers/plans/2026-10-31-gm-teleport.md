# GM Teleport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GMs (usernames in `GM_USERNAMES`) can teleport online characters from the portal: to typed or preset coordinates, or to another online character. The API sends Happy's packet to TControlSvr.

**Architecture:**
- A pure protocol module encodes and decodes TControlSvr frames.
- A `ControlClient` keeps one logged-in TCP connection to TControlSvr, with reconnect.
- A GM module checks GM access, validates the destination against the game's server charts, checks the targets are online, sends the packet and writes an audit row. Presets live in a JSON file.
- The web app adds a GM-only `/gm/teleport` page.

**Tech Stack:** NestJS 12, `node:net`, mssql, Zod 4, Vitest + supertest; React 19, TanStack Router and Query, React Hook Form, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-31-gm-teleport-design.md`. Read it first; section numbers below refer to it.

## Global Constraints

**Protocol (spec 2.2 and 2.3)**
- All values are little-endian. The header is 16 bytes: `u16 size (header included)`, `u16 id`, `u32 0`, `i64 0`.
- STRING is an `int32` byte length followed by raw bytes, with no terminator.
- Message IDs: `CT_OPLOGIN_REQ` 0x9302, `CT_OPLOGIN_ACK` 0x9303, `CT_GROUPLIST_ACK` 0x9306, `CT_USERMOVE_REQ` 0x932E, `CT_USERPOSITION_REQ` 0x9344.
- Never send any other message ID: TControlSvr closes the session on unknown IDs.

**API errors and responses**

| Status | Message |
|---|---|
| 422 | `No server hosts that location` |
| 409 | `Not online: <names joined by ", ">` |
| 503 | `Game server is not connected` |
| 403 | `GM access required` |

- A successful teleport returns 202 `{ sent: true, names }`.

**Limits**
- Character names: `/^[A-Za-z0-9]{1,16}$/`, 1–20 names, unique.
- X and Z: `0 ≤ value < 262144`. Y: any finite number. X, Y and Z must not all be 0.
- World: 1–255. Channel: 1–255. Map ID: 0–65535.
- Preset name: 1–40 characters.

**Audit**
- Call `OPTool_ManagerLog(@pIP varchar(15), @pGMID varchar(15), @pCommand varchar(20), @pLog varchar(1024))` with command `TELEPORT`.
- Strip `::ffff:` from the IP, then cut it to 15 characters. Cut the GM id to 15 characters and the log text to 1024.
- Rejected attempts are prefixed `REJECTED <reason>: `.
- A failure to write the audit row never fails the request.

**Other rules**
- `POST /gm/teleport` is throttled at 30 per 60,000 ms.
- GM usernames are compared case-insensitively. `isGm` is computed per request and never stored in the JWT.
- Tests never connect to a real TControlSvr. DB tests run only against `_TEST` and roll back.
- Web copy:

| Where | Text |
|---|---|
| Success note | `Sent to <names>. The game doesn't confirm teleports, so check in game.` |
| No players | `No one is online right now.` |
| Badge labels | `Connected`, `Connecting…`, `Disconnected`, `Login failed` |

## Review Focus

1. **TCP chunking.** A TControlSvr packet can arrive split across `data` events, or several packets can arrive in one. Frames must still decode exactly. (Task 3 decoder tests; Task 4 test sends login ACK and group list in one write.)
2. **TControlSvr restarts while the API runs.** The status must go to `disconnected`, teleports must return 503, and the client must log in again by itself without piling up timers. (Task 4 reconnect test asserts exactly one reconnect login and no timer after `stop()`.)
3. **A selected player logs out before Send.** The API returns 409 naming them and sends no packet. The UI drops them from the selection on the next refresh. (Task 8 HTTP test; Task 11 web test.)
4. **Names typed in different case** (`kaelith` vs `Kaelith`). They must match as online, and the stored spelling goes in the packet. (Task 8 test.)
5. **A corrupt or hand-edited presets file.** Reading it returns 500 `Preset file is invalid` and the file is not overwritten when someone saves. (Task 7 test.)

---

### Task 1: Shared GM schemas and types

**Files:**
- Create: `packages/shared/src/gm.ts`, `packages/shared/src/gm.test.ts`
- Modify: `packages/shared/src/api-types.ts`, `packages/shared/src/index.ts` (export `./gm.js`)

**Interfaces:**
- Produces, in `gm.ts`:
  - Schemas: `characterNameSchema`, `positionSchema` (object `{ world, channel, mapId, x, y, z }` with the refinements), `teleportRequestSchema`, `gmLocationInputSchema` (`positionSchema` plus `name`)
  - Types: `TeleportRequest`, `PositionDestination = z.infer<typeof positionSchema>`, `GmLocationInput`
- Produces, in `api-types.ts`:
  - `Me = SessionUser & { isGm: boolean }`
  - `ControlState = 'connecting' | 'connected' | 'disconnected' | 'login-failed'`
  - `GmStatus = { state: ControlState; worlds: { id: number; name: string }[]; channels: number[] }`
  - `OnlinePlayer = { charId: number; name: string; level: number; className: string; world: number; channel: number; mapId: number }`
  - `GmLocation = GmLocationInput & { id: string }`
  - `TeleportResult = { sent: true; names: string[] }`
- `teleportRequestSchema` is `{ names: characterNameSchema[] (min 1, max 20, unique), destination }`, where `destination` is a discriminated union on `kind`:
  - `positionSchema.extend({ kind: z.literal('position') })`
  - `{ kind: 'character', world, target }`
- Refinement messages:

| Path | Message |
|---|---|
| `['x']` | `Coordinates cannot all be 0` |
| `['names']` | `Names must be unique` |
| `['destination', 'target']` | `Target cannot also be moved` |

- [ ] **Step 1: Write failing tests in `gm.test.ts`.**
  - `characterNameSchema` accepts `Kaelith` and rejects `''`, `a`×17 and `Kae lith`.
  - `positionSchema` rejects x = 262144, x = -1 and 0/0/0 (issue at path `['x']`). It accepts `{ world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 }`.
  - `teleportRequestSchema` rejects 21 names, duplicate names, and a character destination whose target is in `names`. It accepts both destination kinds.
  - `gmLocationInputSchema` rejects a name longer than 40 characters.
- [ ] **Step 2: Run the tests and confirm they fail.** `npm test -w packages/shared` fails with the module not found.
- [ ] **Step 3: Implement `gm.ts` and the types.** Use `z.number().int()` for IDs and `z.number().finite()` for coordinates.
- [ ] **Step 4: Run the tests and confirm they pass.** Then run `npm run build -w packages/shared`.
- [ ] **Step 5: Commit** `feat(shared): GM teleport schemas and types`.

### Task 2: API config, env and the portal manager script

**Files:**
- Modify: `apps/api/src/config/config.ts`, `apps/api/test/config.test.ts`, `apps/api/test/fixtures.ts`, `.env.example`, `README.md`
- Create: `scripts/db/create-portal-manager.sql`

**Interfaces:**
- Produces: `AppConfig` gains:
  ```
  gm: { usernames: string[] /* lowercased, trimmed, empty entries dropped */; locationsFile: string }
  control: { host: string; port: number; user: string; password: string }
  ```
  Env keys and rules are in spec section 3. `CONTROL_USER` and `CONTROL_PASSWORD` are 1–50 printable ASCII characters. `GM_USERNAMES` defaults to `''`.
- `validEnv` adds:
  ```
  GM_USERNAMES: 'Moose'
  CONTROL_HOST: '127.0.0.1'
  CONTROL_PORT: '3616'
  CONTROL_USER: 'portal'
  CONTROL_PASSWORD: 'secret'
  GM_LOCATIONS_FILE: './data/gm-locations.json'
  ```

- [ ] **Step 1: Write failing config tests.**
  - `GM_USERNAMES: ' Moose, ,Alice '` gives `gm.usernames` equal to `['moose', 'alice']`.
  - A missing `GM_USERNAMES` gives `[]`.
  - `CONTROL_PORT: 'x'` throws with `CONTROL_PORT` in the message.
  - A `CONTROL_PASSWORD` of 51 characters throws.
- [ ] **Step 2: Run `npm test -w apps/api -- config` and confirm it fails.**
- [ ] **Step 3: Implement the schema additions and the mapping.**
- [ ] **Step 4: Add the six keys to `.env.example`, with comments.**
  - `GM_USERNAMES=moose`
  - The `CONTROL_*` comment says port 3616 must stay firewalled to this machine.
  - `GM_LOCATIONS_FILE=./data/gm-locations.json`
  - Add `apps/api/data/` to `.gitignore`.
- [ ] **Step 5: Write `scripts/db/create-portal-manager.sql`.**
  - `USE` a `:setvar DB TGLOBAL_GSP_TEST` variable.
  - Abort with `RAISERROR` unless `DB_NAME()` ends in `_TEST` or `:setvar ALLOW_LIVE 1` is set.
  - Insert `TMANAGER (szID, szPasswd, bAuthority)` = `('portal', '$(PORTAL_PASSWORD)', 3)` if no row exists, otherwise update the password.
- [ ] **Step 6: Add a "GM tools" section to `README.md`** with the three operational notes from spec section 7 and the `sqlcmd ... -v PORTAL_PASSWORD=...` command.
- [ ] **Step 7: Run `npm test -w apps/api` and confirm it is green.** Then commit `feat(api): GM and control server configuration`.

### Task 3: Control protocol (pure)

**Files:**
- Create: `apps/api/src/control/control-protocol.ts`, `apps/api/test/control-protocol.test.ts`

**Interfaces:**
- Produces:
  - `MSG = { OPLOGIN_REQ: 0x9302, OPLOGIN_ACK: 0x9303, GROUPLIST_ACK: 0x9306, USERMOVE_REQ: 0x932E, USERPOSITION_REQ: 0x9344 } as const`
  - `type Frame = { id: number; body: Buffer }`
  - `encodeFrame(id: number, body: Buffer): Buffer`
  - `class BodyWriter`: `byte(n)`, `word(n)`, `dword(n)` and `float(n)` each return `this`; `string(s: string)` uses latin1 and returns `this`; `toBuffer(): Buffer`
  - `class InvalidFrameError extends Error`
  - `class FrameDecoder`: `push(chunk: Buffer): Frame[]`. It throws `InvalidFrameError` when the size is below 16 or equals 0xFFFF, and keeps partial bytes between calls.
  - `encodeLogin(id: string, password: string): Buffer`
  - `encodeUserMove(p: { world: number; channel: number; mapId: number; x: number; y: number; z: number }, names: string[]): Buffer`
  - `encodeUserPosition(world: number, target: string, names: string[]): Buffer`
  - `decodeLoginAck(body: Buffer): { ok: boolean; authority: number; managerId: number }` (`ok` is `ret === 0`)
  - `decodeGroupList(body: Buffer): { id: number; name: string }[]`

- [ ] **Step 1: Write failing tests.**
  - `encodeUserMove({ world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 }, ['mrdkos'])` equals `Buffer.from('2C002E93000000000000000000000000010100000000 2F45000048420040 9C45010006000000 6D72646B6F73'.replace(/ /g, ''), 'hex')`. This is the spec's reference frame.
  - `encodeLogin('portal', 'pw')` has length 32, bytes 0–3 `20 00 02 93`, and a body of `06000000` + `portal` + `02000000` + `pw`.
  - `encodeUserPosition(1, 'Moosey', ['Kaelith'])` has size 40 and body `01` + `06000000`+`Moosey` + `0100` + `07000000`+`Kaelith`.
  - Feeding `FrameDecoder` two frames joined and split at byte 5 and byte 21 yields both frames in order, with the right ids and bodies.
  - A header with size 15 throws `InvalidFrameError`.
  - `decodeGroupList` of `dword 2, byte 0, 'Global', byte 1, 'Lapiris'` gives both entries.
  - `decodeLoginAck` of `00 03 07000000` gives `{ ok: true, authority: 3, managerId: 7 }`.
- [ ] **Step 2: Run `npm test -w apps/api -- control-protocol` and confirm it fails.**
- [ ] **Step 3: Implement.** Decoders read with `Buffer.readUInt8/16LE/32LE`. The STRING reader reads an `int32` length and then `latin1` bytes.
- [ ] **Step 4: Run the tests and confirm they pass.** Then commit `feat(api): TControlSvr protocol encoding`.

### Task 4: ControlClient

**Files:**
- Create: `apps/api/src/control/control-client.ts`, `apps/api/src/control/control.module.ts`, `apps/api/test/control-client.test.ts`
- Modify: `apps/api/src/app.module.ts` (import `ControlModule`)

**Interfaces:**
- Consumes: Task 3 exports, and `AppConfig['control']`.
- Produces:
  - `class ControlUnavailableError extends Error`
  - `class ControlClient implements OnModuleInit, OnModuleDestroy`
    - `constructor(config: AppConfig['control'], options?: { retryDelaysMs?: number[] })`. The default delays are `[1000, 2000, 4000, 8000, 16000, 30000]`, and the last value repeats.
    - `start(): void`, which connects and does not wait for the result
    - `stop(): Promise<void>`, which destroys the socket and clears the retry timer
    - `onModuleInit()` calls `start()`; `onModuleDestroy()` calls `stop()`
    - `status(): { state: ControlState; worlds: { id: number; name: string }[] }`. The worlds exclude id 0.
    - `moveToPosition(p: PositionDestination, names: string[]): void`
    - `moveToCharacter(world: number, target: string, names: string[]): void`
    - Both move methods throw `ControlUnavailableError` unless the state is `connected`.
  - `ControlModule` is `@Global()` and provides `{ provide: ControlClient, useFactory: (c: AppConfig) => new ControlClient(c.control), inject: [CONFIG] }`, exporting it.
- Behaviour:
  - `connected` is set on an `OPLOGIN_ACK` with ok; the worlds come from `GROUPLIST_ACK`. Every other frame is ignored.
  - A failed `OPLOGIN_ACK` sets `login-failed`, destroys the socket and does not retry.
  - A close or error while not `login-failed` sets `disconnected` and schedules a reconnect. Successful login resets the delay index.
  - An `InvalidFrameError` destroys the socket.
  - `setKeepAlive(true)` is on. Log state changes with Nest `Logger`.

- [ ] **Step 1: Write failing tests** against a fake server: `net.createServer` on port 0, decoding with `FrameDecoder` and replying with `encodeFrame`. Use `retryDelaysMs: [20]`, and poll with `vi.waitFor`.
  - **Login success:** the server receives exactly `encodeLogin('portal', 'secret')`. It replies with the login ACK and the group list `[0 Global, 1 Lapiris]` in a single `write`, followed by a 0x9321 frame with a 44-byte zero body. The status becomes `{ state: 'connected', worlds: [{ id: 1, name: 'Lapiris' }] }`.
  - **Teleport bytes:** `moveToPosition` with the reference position and `['mrdkos']` makes the server receive the reference frame bytes.
  - **Login failure:** the ACK `01 00 00000000` gives `login-failed`. After 100 ms the server has seen exactly one connection.
  - **Reconnect:** the server destroys the socket after login. The status goes to `disconnected`, then `connected` again, and the server has seen exactly 2 logins.
  - **Disconnected client:** `moveToCharacter` throws `ControlUnavailableError` before any connection.
  - **`stop()`:** after `stop()` with the server closed, no further connection attempt happens within 100 ms.
- [ ] **Step 2: Run `npm test -w apps/api -- control-client` and confirm it fails.**
- [ ] **Step 3: Implement `ControlClient` and `ControlModule`.**
- [ ] **Step 4: Update `test/test-app.ts`** to override `ControlClient` with a `FakeControlClient`, added to `test/fakes.ts`:
  - public `state` and `worlds`
  - a `moves: unknown[]` log
  - methods with the same signatures, which throw `ControlUnavailableError` unless `state === 'connected'`
  - `TestAppOverrides.control?: FakeControlClient`
- [ ] **Step 5: Run `npm test -w apps/api` and confirm it is green.** Then commit `feat(api): persistent TControlSvr client`.

### Task 5: GM access and `isGm` on the session responses

**Files:**
- Create: `apps/api/src/auth/gm-access.ts` (`GmAccess` service and `GmGuard`)
- Modify: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts` (provide and export `GmAccess`, `GmGuard`), `apps/api/test/auth.http.test.ts`

**Interfaces:**
- Produces:
  - `GmAccess.isGm(username: string): boolean`
  - `GmAccess.me(user: SessionUser): Me`
  - `GmGuard implements CanActivate`. It reads `req.user` set by `SessionGuard` and throws `ForbiddenException('GM access required')` for non-GMs. It must be listed after `SessionGuard` in `@UseGuards`.
- `POST /auth/login`, `POST /auth/register` and `GET /auth/me` now return `Me`.

- [ ] **Step 1: Update and add tests.**
  - Change the existing `toEqual({ userId, username })` expectations to include `isGm: false`, using a non-GM account such as `newuser`.
  - Add: logging in as `moose` returns `isGm: true` because `validEnv` has `Moose`, which shows the comparison is case-insensitive.
  - Add: `GET /api/auth/me` for a non-GM returns `isGm: false`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** `AuthController.signIn` and `me` return `this.gm.me(user)`.
- [ ] **Step 4: Run `npm test -w apps/api` and confirm it is green.** Then commit `feat(api): GM access check and isGm flag`.

### Task 6: GM repository

**Files:**
- Create: `apps/api/src/gm/gm.repository.ts`, `apps/api/test/db/gm.db.test.ts`
- Modify: `apps/api/src/db/db.service.ts` (`tableNames`), `apps/api/test/table-names.test.ts`

**Interfaces:**
- Produces:
  - `tableNames` adds:
    - `currentUsers: '[<global>].dbo.TCURRENTUSER'`
    - `serverChart: '[<game>].dbo.TSVRCHART'`
    - `channelChart: '[<game>].dbo.TCHANNELCHART'`
    - `managerLog: '[<global>].dbo.OPTool_ManagerLog'`
  - `type OnlinePlayerRow = { charId: number; name: string; level: number; classCode: number; world: number; channel: number; mapId: number }`
  - `type AuditEntry = { ip: string; gmId: string; log: string }`
  - `interface GmRepository`:
    - `listOnlinePlayers(): Promise<OnlinePlayerRow[]>`
    - `listChannels(): Promise<number[]>`
    - `isLocationHosted(p: PositionDestination): Promise<boolean>`
    - `writeAudit(e: AuditEntry): Promise<void>`
  - `GM_REPOSITORY` symbol, and `SqlGmRepository implements GmRepository`:
    - `constructor(db: DbService)`
    - `withTransaction(tx: sql.Transaction): SqlGmRepository`, which returns a copy that runs its queries on `tx` (for tests)
- SQL:
  - **Online players:** `TCURRENTUSER u JOIN TCHARTABLE c ON c.dwCharID = u.dwCharID WHERE u.dwCharID <> 0 AND c.bDelete = 0 ORDER BY c.szNAME`, selecting the aliases in `OnlinePlayerRow`.
  - **Channels:** `SELECT DISTINCT bLogChannel FROM TCHANNELCHART ORDER BY 1`.
  - **Hosted check:** the spec 2.4 query with `@unit = Math.floor(z/1024)*256 + Math.floor(x/1024)` computed in JS.
  - **Audit:** `EXEC <managerLog> @pIP, @pGMID, @pCommand = 'TELEPORT', @pLog`. The repository applies the length cuts from Global Constraints.

- [ ] **Step 1: Update `table-names.test.ts`** with the four new entries, and confirm it fails.
- [ ] **Step 2: Write `gm.db.test.ts`.** Every test runs inside `inRolledBackTransaction` using `repo.withTransaction(tx)`.
  - Insert a `TCURRENTUSER` row for one existing live character of `moose`, with `dwCharID`, `bGroupID 1`, `bChannel 2`, `dwKEY 999999`, `wPort 0`, `bLocked 0`, the date columns `GETDATE()`, `dwPcBangID 0`, `bLuckyNumber 0`, `szLoginIP '127.0.0.1'`. `listOnlinePlayers` contains it with `world 1` and `channel 2`.
  - `listChannels()` equals `[1, 2, 3, 50]`.
  - `isLocationHosted({ world: 1, channel: 1, mapId: 0, x: 2850.52, y: 68.36, z: 5004.94 })` is true. This is spawn point 1001, unit 1026, verified to be hosted by server 1.
  - `isLocationHosted` is false for `mapId: 65000`.
  - `writeAudit({ ip: '::ffff:127.0.0.1', gmId: 'a'.repeat(20), log: 'x'.repeat(2000) })` inserts a `TMANAGERLOG` row with `szIP '127.0.0.1'`, a 15-character `szGMID` and `szCommand 'TELEPORT'`.
- [ ] **Step 3: Implement `SqlGmRepository`.**
- [ ] **Step 4: Run `npm test -w apps/api` and `npm run test:db -w apps/api` and confirm both are green.** Then commit `feat(api): GM repository for online players, server charts and audit`.

### Task 7: Presets store

**Files:**
- Create: `apps/api/src/gm/gm-locations.store.ts`, `apps/api/test/gm-locations.store.test.ts`

**Interfaces:**
- Produces:
  - `class GmLocationsStore`, constructed with `(file: string)`
  - `list(): Promise<GmLocation[]>`
  - `add(input: GmLocationInput): Promise<GmLocation>` (id from `crypto.randomUUID()`)
  - `remove(id: string): Promise<boolean>`
  - `class InvalidPresetFileError extends Error`
  - `GM_LOCATIONS_STORE` token, provided by Task 8's module from `config.gm.locationsFile`
- Behaviour:
  - A missing file reads as `[]`.
  - An invalid JSON or schema throws `InvalidPresetFileError`.
  - Writes `mkdir -p` the directory, write `<file>.tmp`, then rename. Mutations are serialised through a private promise chain.

- [ ] **Step 1: Write failing tests** using a fresh `mkdtemp` directory per test.
  - With no file, the list is `[]`.
  - `add` then `list` returns the preset with a UUID id, and a fresh store on the same file sees it.
  - Two concurrent `add` calls both persist.
  - `remove` returns `true` and the list is then empty; `remove` of an unknown id returns `false`.
  - A file containing `{` makes `list` reject with `InvalidPresetFileError`, `add` rejects too, and the file contents are unchanged.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement the store.**
- [ ] **Step 4: Run and confirm they pass.** Then commit `feat(api): JSON store for GM location presets`.

### Task 8: Teleport service, GM controller and module

**Files:**
- Create: `apps/api/src/gm/teleport.service.ts`, `apps/api/src/gm/gm.controller.ts`, `apps/api/src/gm/gm.module.ts`, `apps/api/test/gm.http.test.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/test-app.ts` (overrides for `GM_REPOSITORY` and `GM_LOCATIONS_STORE`), `apps/api/test/fakes.ts` (`FakeGmRepository`)

**Interfaces:**
- Consumes: `ControlClient` (Task 4), `GmAccess` and `GmGuard` (Task 5), `GmRepository` (Task 6), `GmLocationsStore` (Task 7), `className` from `characters/character-codes.ts`.
- Produces:
  - `TeleportService.teleport(req: TeleportRequest, actor: { username: string; ip: string }): Promise<TeleportResult>`
  - `TeleportService.onlinePlayers(): Promise<OnlinePlayer[]>`
  - `FakeGmRepository`:
    - public `players: OnlinePlayerRow[]`, `channels`, `hosted = true`, `audits: AuditEntry[]`, and `failAudit = false`
    - when `failAudit` is set, `writeAudit` rejects
- Controller: `@Controller('gm') @UseGuards(SessionGuard, GmGuard)`.
  - Routes are as in spec 4.3, with bodies parsed by `ZodValidationPipe`.
  - `POST teleport` uses `@HttpCode(202)`, `ThrottlerGuard` and `@Throttle({ default: { limit: 30, ttl: 60_000 } })`. The IP is `req.ip`.
  - `DELETE locations/:id` returns 204, or `NotFoundException('Preset not found')`.
  - `InvalidPresetFileError` maps to `InternalServerErrorException('Preset file is invalid')`.
- Teleport algorithm (spec 4.4):
  1. For a position destination, `isLocationHosted`. If false, audit `REJECTED no-server: …` and throw 422.
  2. Load the online players. A name is online when a player in `world` matches it case-insensitively. Required names are `names` plus `target` for a character destination. If any are missing, audit `REJECTED offline: …` and throw 409, listing the missing names in request order.
  3. Call the control method with the **stored** spellings. On `ControlUnavailableError`, audit `REJECTED disconnected: …` and throw 503.
  4. Audit the success. Audit lines use the spec 4.4 formats; positions use JS default number formatting, e.g. `(2800,50,5000)`.
  5. Return `{ sent: true, names: storedNames }`.

  `writeAudit` errors are caught and logged with `Logger.warn`.

- [ ] **Step 1: Write failing HTTP tests in `gm.http.test.ts`.** Log in as `moose` (a GM) and as `newuser` (not a GM) through the fake accounts.
  - **403:** every `/api/gm/*` route returns 403 `GM access required` for the non-GM, and 401 without a session.
  - **Status:** `GET /gm/status` returns `{ state: 'connected', worlds: [{ id: 1, name: 'Lapiris' }], channels: [1, 2, 3, 50] }`.
  - **Players:** `GET /gm/players` maps `classCode: 3` to `className: 'Wizard'`.
  - **400:** a teleport with x = -1 returns 400 with `fieldErrors`.
  - **422:** with `hosted = false`, no move is sent and the audit log starts with `REJECTED no-server`.
  - **409:** with `Kaelith` online but `Moosey` not, the response is `Not online: Moosey` and no move is sent.
  - **Case:** a request for `kaelith`, where the stored name is `Kaelith`, makes `control.moves[0]` contain `['Kaelith']`.
  - **503:** with `control.state = 'disconnected'`, the response is `Game server is not connected` and the audit log starts with `REJECTED disconnected`.
  - **202:** a position teleport returns `{ sent: true, names: ['Kaelith'] }` and records the move. The audit is `{ gmId: 'moose', log: 'Kaelith -> w1 ch1 map0 (2800,50,5000)' }`.
  - **Character destination:** the move records `moveToCharacter(1, 'Moosey', ['Kaelith'])` and the audit is `Kaelith -> char Moosey`.
  - **Audit failure:** with `failAudit = true`, the response is still 202.
  - **Presets:** `POST` returns 201 with an id, `GET` lists it, `DELETE` returns 204, and a second `DELETE` returns 404. Use a temp-dir store override.
  - **Throttle:** the 31st teleport within a minute returns 429.
- [ ] **Step 2: Run `npm test -w apps/api -- gm.http` and confirm it fails.**
- [ ] **Step 3: Implement the service, controller and module.** `GmModule` imports `AuthModule` and provides `GM_REPOSITORY`, `GM_LOCATIONS_STORE` (factory from `CONFIG`) and `TeleportService`.
- [ ] **Step 4: Run `npm test -w apps/api` and `npm run lint -w apps/api` and confirm both are green.** Then commit `feat(api): GM teleport, players, status and preset endpoints`.

### Task 9: Web session `isGm`, GM link, route guard and data hooks

**Files:**
- Modify: `apps/web/src/lib/session.ts` (`Me` type), `apps/web/src/routes/_authed.tsx`, `apps/web/src/test/render-route.tsx` (`me: Me | null`), the existing web tests (add `isGm: false` to their `me` constants), `apps/web/src/lib/form-errors.ts`
- Create: `apps/web/src/lib/gm.ts`, `apps/web/src/components/StatusBadge.tsx`, `apps/web/src/routes/_authed/gm/teleport.tsx` (page shell: title, badge, guard), `apps/web/src/routes/gm-teleport.test.tsx`, `apps/web/src/lib/form-errors.test.ts`

**Interfaces:**
- Produces in `lib/gm.ts`:
  - Query options:

| Name | Key | Endpoint | Refetch interval |
|---|---|---|---|
| `gmStatusQueryOptions` | `['gm', 'status']` | `GET /gm/status` | 5000 |
| `onlinePlayersQueryOptions` | `['gm', 'players']` | `GET /gm/players` | 10000 |
| `gmLocationsQueryOptions` | `['gm', 'locations']` | `GET /gm/locations` | none |

  - Mutations:
    - `useTeleport()` posts `/gm/teleport` and returns a `TeleportResult`.
    - `useSaveLocation()` and `useDeleteLocation()` invalidate `['gm', 'locations']`.
- Produces: `StatusBadge({ state }: { state: ControlState })`, which renders the label and colour from spec 5.2 with `role="status"`.
- Produces: `applyServerError` returns `error.message` for status 503 (other 5xx keep the generic text).
- The route `/_authed/gm/teleport` has `beforeLoad`: `ensureQueryData(meQueryOptions)`, then `throw redirect({ to: '/characters' })` unless `isGm`.
- The header link is `<Link to="/gm/teleport">GM</Link>`, shown only when `me.isGm`.

- [ ] **Step 1: Write failing tests.**
  - `form-errors.test.ts`: a 503 `ApiError('Game server is not connected')` returns that message, and a 500 still returns `Something went wrong. Please try again.`
  - `gm-teleport.test.tsx`:
    - A GM on `/characters` sees the `GM` link; a non-GM does not.
    - A non-GM visiting `/gm/teleport` ends up on `/characters`.
    - A GM sees the heading `Teleport` and the `Connected` badge when the mocked `/gm/status` says connected, and `Login failed` for `login-failed`.
- [ ] **Step 2: Run `npm test -w apps/web` and confirm the new tests fail.**
- [ ] **Step 3: Implement.** Update the existing tests' `me` objects so typecheck passes.
- [ ] **Step 4: Run `npm test -w apps/web` and `npm run lint -w apps/web` and confirm both are green.** Then commit `feat(web): GM flag, GM link and teleport page shell`.

### Task 10: Form primitives: Checkbox, Select, Tabs, number fields

**Files:**
- Create: `apps/web/src/components/Checkbox.tsx`, `Select.tsx`, `Tabs.tsx`, `apps/web/src/components/Tabs.test.tsx`
- Modify: `apps/web/src/components/TextField.tsx` (`type` adds `'number'`, plus an optional `step`)

**Interfaces:**
- Produces:
  - `Checkbox(props: InputHTMLAttributes<HTMLInputElement> & { label: string })`, a native checkbox with a visually hidden-or-visible label
  - `Select({ label, registration, error, options }: { label: string; registration: UseFormRegisterReturn; error?: string; options: { value: string | number; label: string }[] })`, styled like `TextField`
  - `Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange(id: string): void })`
    - renders `role="tablist"` with `role="tab"` buttons and `aria-selected`
    - ArrowLeft and ArrowRight move the selection, wrapping around, and focus the new tab
    - only the active tab has `tabIndex` 0
    - panels are rendered by the caller with `role="tabpanel"`

- [ ] **Step 1: Write failing `Tabs.test.tsx`.** Clicking the second tab calls `onChange('character')`. ArrowRight on the last tab calls `onChange` with the first id. The active tab has `aria-selected="true"`.
- [ ] **Step 2: Run and confirm it fails.**
- [ ] **Step 3: Implement all four, using the existing tokens** (`rounded-xs`, `border-line`, `bg-surface-raised`, focus ring as in `Button`).
- [ ] **Step 4: Run the tests and lint and confirm they are green.** Then commit `feat(web): checkbox, select and tabs components`.

### Task 11: Teleport page: players panel, coordinates form and send

**Files:**
- Create: `apps/web/src/components/gm/PlayersPanel.tsx`, `apps/web/src/components/gm/PositionForm.tsx`
- Modify: `apps/web/src/routes/_authed/gm/teleport.tsx`, `apps/web/src/routes/gm-teleport.test.tsx`

**Interfaces:**
- Consumes: Task 9 hooks and Task 10 components.
- Produces:
  - `PlayersPanel({ players, selected, onChange }: { players: OnlinePlayer[]; selected: string[]; onChange(names: string[]): void })`. It owns the search box, the table, the select-all checkbox, the `N selected` count, the Refresh button and the empty text.
  - `PositionForm({ worlds, channels, disabledReason, onSubmit })`. It uses React Hook Form with `zodResolver(positionSchema)`.
    - Fields: World and Channel are `Select`s; Map ID, X, `Height (Y)` and Z are number `TextField`s.
    - The submit button reads `Teleport N player(s)`. When `disabledReason` is set it is disabled and shows the reason.
- Page state:
  - `selected: string[]` holds player names. Whenever the players data changes, it is pruned to names still online.
  - The page renders the success note or a `FormMessage` from `applyServerError`.
  - The send button is disabled when nothing is selected, with the reason `Select at least one player`, or when the state is not `connected`, with the reason `Game server is not connected`.

- [ ] **Step 1: Write failing tests** in `gm-teleport.test.tsx`, mocking `/gm/status`, `/gm/players`, `/gm/locations` and `POST /gm/teleport`.
  - The players table lists the mocked players. Typing `kae` in search shows only `Kaelith`.
  - The empty list shows `No one is online right now.`
  - Selecting `Kaelith`, filling the coordinates (world `Lapiris`, channel 1, map 0, 2800/50/5000) and clicking `Teleport 1 player` sends body `{ names: ['Kaelith'], destination: { kind: 'position', world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 } }`. Check with `sentBodies`. Then it shows `Sent to Kaelith. The game doesn't confirm teleports, so check in game.`
  - A 409 `Not online: Kaelith` response shows that text.
  - A 503 response shows `Game server is not connected`.
  - When `/gm/status` is `disconnected`, the send button is disabled and the page shows `Game server is not connected`.
  - When the players refetch no longer includes `Kaelith`, the count shows `0 selected`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement the panels and wire the page.** Use a two-column grid at `lg:` and a single column below that.
- [ ] **Step 4: Run `npm test -w apps/web` and lint and confirm both are green.** Then commit `feat(web): teleport players panel and coordinates form`.

### Task 12: Presets and teleport to a character

**Files:**
- Create: `apps/web/src/components/gm/PresetsList.tsx`, `apps/web/src/components/gm/CharacterTargetForm.tsx`
- Modify: `apps/web/src/components/gm/PositionForm.tsx` (accepts `values` to fill in, and gains a `Save as preset` inline name field), `apps/web/src/routes/_authed/gm/teleport.tsx`, `apps/web/src/routes/gm-teleport.test.tsx`

**Interfaces:**
- Produces:
  - `PresetsList({ locations, onPick, onDelete })`. Each delete asks inline: `Delete?` with confirm and cancel buttons.
  - `CharacterTargetForm({ world, candidates, disabledReason, onSubmit })`. `candidates` are the online players minus the selected ones. It submits `{ kind: 'character', world, target }`.
  - The page wraps the two forms in `Tabs` with ids `position` / `character` and labels `Coordinates` / `Character`.

- [ ] **Step 1: Write failing tests.**
  - Clicking preset `Town square` fills X/Y/Z, map and channel from it.
  - `Save as preset` with name `Gate` posts `/gm/locations` with the current fields and the list then shows `Gate`.
  - Delete followed by confirm sends `DELETE /gm/locations/<id>`.
  - On the Character tab, choosing target `Moosey` with `Kaelith` selected sends `{ names: ['Kaelith'], destination: { kind: 'character', world: 1, target: 'Moosey' } }`. The target list excludes `Kaelith`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test -w apps/web` and lint and confirm both are green.** Then commit `feat(web): GM location presets and teleport to character`.

### Task 13: Whole-app verification and manual end-to-end

**Files:** none, unless fixes are needed.

- [ ] **Step 1: Run `npm run lint && npm test && npm run build` at the root and `npm run test:db`.** All must be green.
- [ ] **Step 2: Run the app with the API pointed at a closed port** (`CONTROL_PORT=3699`). Screenshot `/gm/teleport` and check the badge reads `Disconnected` and Send is disabled.
- [ ] **Step 3: Hand over to the user for the live test.**
  1. Create the `portal` manager in `_TEST` with the script.
  2. Start TControlSvr.
  3. Log a character in with the game client.
  4. Teleport the character from the portal.
  5. Confirm it moves, and confirm a `TMANAGERLOG` row exists.

  Record the outcome in the PR description.
