# GM tools: teleport

Date: 2026-10-31. Status: approved design, awaiting spec review.

## 1. Goal

Let a GM teleport online players from the portal, doing what the legacy MFC tool **Happy** does, through the web UI.

- A GM picks one or more online characters and a destination: either a world, channel, map and coordinates (typed or picked from a saved preset), or another online character's position.
- The API sends the same packet Happy sends to the game's control server (TControlSvr).

**Who counts as a GM:** a portal user whose game account username is listed in `GM_USERNAMES` (initially `moose`).

**Out of scope for this version:**
- teleporting offline characters (rewriting `TCHARTABLE` positions)
- other GM tools: kick, announce, ban, monster spawn
- map names, because the database has none; maps are shown by ID
- confirming that a teleport happened in game

## 2. Facts from the game

From the game source (`C:\Users\stath\Documents\4Story\4s\4Story_5.0_Source - kopie`, `Server\` tree) and the database. These cannot be changed by the portal.

### 2.1 Connection and login

- Happy connects to **TControlSvr on TCP 3616**: `ControlPort` in `Configurations\TControlSvr.ini`. TControlSvr sends nothing when a client connects.
- **Login:** `CT_OPLOGIN_REQ` (0x9302) with body `STRING id, STRING password`, in plain text.
  - TControlSvr checks it with `TOPLogin`: `SELECT bAuthority FROM TGLOBAL_GSP.dbo.TMANAGER WHERE szID=@id AND szPasswd=@pw`. Both columns are `varchar(50)`, plaintext.
  - **Success:** `CT_OPLOGIN_ACK` (0x9303) with `BYTE ret (0 = ok), BYTE authority, DWORD managerId`, followed by `CT_GROUPLIST_ACK` (0x9306) with `DWORD n, n × { BYTE groupId, STRING name }`, then other list packets.
  - **Failure:** `CT_OPLOGIN_ACK` with ret = 1.
- **Duplicate login:** logging in with an id that is already connected closes **both** sessions. The portal therefore needs its own `TMANAGER` account.
- **Authority:** a lower number means more power (1 ALL, 2 CONTROL, 3 USER, 4 SERVICE, 5–7 GM levels). Teleport needs authority 6 or lower.
- **No keep-alive**, no idle timeout and no encryption.
- **Unsolicited packets:** TControlSvr sends status packets (e.g. `CT_SERVICEDATA_ACK` 0x9321) about once a second after login.
- **Unknown IDs:** any message ID TControlSvr does not handle closes the session.

### 2.2 Packet framing

Little-endian, no padding between fields. Every packet is a 16-byte header followed by the body.

| Offset | Type | Field |
|---|---|---|
| 0 | u16 | total size **including** the header (≥ 16, never 0xFFFF) |
| 2 | u16 | message ID |
| 4 | u32 | 0 |
| 8 | i64 | 0 |

Field encodings:

| Type | Encoding |
|---|---|
| BYTE | 1 byte |
| WORD | 2 bytes |
| DWORD | 4 bytes |
| FLOAT | 4-byte IEEE-754 |
| STRING | `int32` byte length, then the raw bytes, no terminator. Character names are ASCII. |

Incoming data is a stream: accumulate bytes and cut a frame whenever at least 16 bytes are buffered and the buffer holds at least `size` bytes.

### 2.3 Teleport packets

**`CT_USERMOVE_REQ` (0x932E):** move characters to a position.

| Body offset | Type | Field |
|---|---|---|
| 0 | BYTE | world (`TGROUP.bGroupID`; 1 = "Lapiris") |
| 1 | BYTE | channel (logical, `TCHANNELCHART.bLogChannel`: 1, 2, 3, 50) |
| 2 | WORD | map ID |
| 4 | FLOAT | X |
| 8 | FLOAT | Y = **height** |
| 12 | FLOAT | Z |
| 16 | WORD | name count |
| 18 | STRING × count | character names |

Reference frame: world 1, channel 1, map 0, (2800, 50, 5000), name "mrdkos".

```
2C 00 2E 93 00 00 00 00 00 00 00 00 00 00 00 00 01 01 00 00 00 00 2F 45 00 00 48 42 00 40 9C 45 01 00 06 00 00 00 6D 72 64 6B 6F 73
```

**`CT_USERPOSITION_REQ` (0x9344):** move characters to another character.

| Type | Field |
|---|---|
| BYTE | world |
| STRING | target character |
| WORD | name count |
| STRING × count | characters to move |

### 2.4 How the game handles a teleport

1. TControlSvr forwards the request to the world server of that group.
2. The world server forwards it to the character's map server.
3. The map server teleports the character, including moving it to another channel or map server.

Limits that follow from this:
- **Online only.** An offline character is dropped silently.
- **No reply** of any kind comes back to the tool.
- **Coordinates 0/0/0** send the character to its spawn point.
- **No destination validation.** If no server hosts the (map, cell, channel), the player is left stuck until they relog. A server hosts a location when there is a row with:
  ```
  TGAME_GSP.dbo.TSVRCHART s JOIN TCHANNELCHART c
    ON s.bGroup = c.bGroupID AND s.wMapID = c.wMapID AND s.wUnitID = c.wUnitID AND s.bChannel = c.bPhyChannel
  WHERE s.bGroup = @world AND s.wMapID = @map
    AND s.wUnitID = (FLOOR(z/1024) * 256 + FLOOR(x/1024)) AND c.bLogChannel = @channel
  ```

### 2.5 Other data

- **Online characters:** `TGLOBAL_GSP.dbo.TCURRENTUSER` rows with `dwCharID <> 0` give `bGroupID` (world) and `bChannel`. Names, level, class and the last saved map come from `TGAME_GSP.dbo.TCHARTABLE` (`dwCharID`, `szNAME`, `bLevel`, `bClass`, `wMapID`, `bDelete = 0`). The live position is only in server memory.
- **Audit log:** `TGLOBAL_GSP.dbo.OPTool_ManagerLog(@pIP varchar(15), @pGMID varchar(15), @pCommand varchar(20), @pLog varchar(1024))` inserts into `TMANAGERLOG`. Nothing logs teleports today.

### 2.6 Security weaknesses in TControlSvr

- It runs commands for sessions that never logged in. **Port 3616 must never be reachable from outside the server machine.**
- Its action log copies into `char[256]` with `lstrcpy`, so very long names could overflow it. Names must stay short.

## 3. Configuration

New `.env` keys, validated by the existing Zod config schema:

| Key | Example | Rule |
|---|---|---|
| `GM_USERNAMES` | `moose` | Comma-separated, trimmed, compared case-insensitively. May be empty (no GMs). |
| `CONTROL_HOST` | `127.0.0.1` | Required |
| `CONTROL_PORT` | `3616` | Positive integer |
| `CONTROL_USER` | `portal` | 1–50 characters |
| `CONTROL_PASSWORD` | | 1–50 characters |
| `GM_LOCATIONS_FILE` | `./data/gm-locations.json` | Path relative to the API's working directory. The file is created on first save. |

- `.env.example` documents all of them.
- `scripts/db/create-portal-manager.sql` inserts the `TMANAGER` row (`szID = 'portal'`, `bAuthority = 3`). It is guarded to run against `_TEST` by default; the live database is a manual step for the operator.

## 4. API (NestJS)

### 4.1 `control/` module

**`control-protocol.ts`** holds pure functions with no I/O:
- `encodeFrame(id, body)`
- a `BodyWriter` with `byte`, `word`, `dword`, `float`, `string`
- a `FrameDecoder` that takes chunks and returns complete frames
- `encodeLogin`, `encodeUserMove`, `encodeUserPosition`
- `decodeLoginAck`, `decodeGroupList`

**`ControlClient`** is an injectable service that owns one TCP socket.

- **Start:** connect on module init, then send `CT_OPLOGIN_REQ`.
- **Status:** `connecting` → `connected` on `OPLOGIN_ACK` with ret 0, storing the world list from `GROUPLIST_ACK` and skipping every other frame.
- **Login failure:** ret 1 makes the status `login-failed`. It does not retry until the API restarts.
- **Disconnect** (socket closed or error): the status becomes `disconnected`, then the client reconnects with backoff of 1, 2, 4, 8, 16 and 30 seconds, capped at 30, and resets after a successful login. `socket.setKeepAlive(true)` is on.
- **Bad frame** (size < 16 or 0xFFFF): destroy the socket, which triggers a reconnect.
- **Methods:**
  - `status(): { state, worlds: { id, name }[] }`. Group 0 is excluded.
  - `moveToPosition(...)` and `moveToCharacter(...)` throw `ControlUnavailableError` unless the status is `connected`.

### 4.2 GM access

- `GmService.isGm(username)` checks it against `GM_USERNAMES`.
- `GmGuard` runs after `SessionGuard` and throws 403 "GM access required" for non-GMs.
- `GET /auth/me` adds `isGm: boolean`. The `SessionUser` type in `packages/shared` gains `isGm`.

### 4.3 Endpoints

Everything is under `@UseGuards(SessionGuard, GmGuard)`.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/gm/status` | | `{ state, worlds: {id, name}[], channels: number[] }`. Channels are the distinct `TCHANNELCHART.bLogChannel` values. |
| GET | `/gm/players` | | `OnlinePlayer[]`: `{ charId, name, level, className, world, channel, mapId }`, sorted by name |
| POST | `/gm/teleport` | `TeleportRequest` | 202 `{ sent: true, names }` |
| GET | `/gm/locations` | | `GmLocation[]`: `{ id, name, world, channel, mapId, x, y, z }` |
| POST | `/gm/locations` | `GmLocationInput` | 201 `GmLocation`. The `id` is a UUID. |
| DELETE | `/gm/locations/:id` | | 204, or 404 if the preset doesn't exist |

**Shared Zod schemas** in `packages/shared`:
- `characterName`: 1–16 characters, letters and digits.
- `TeleportRequest`: `{ names: characterName[] (1–20, unique), destination }`, where `destination` is one of:
  - `{ kind: 'position', world: 1–255, channel: 1–255, mapId: 0–65535, x, z: 0 ≤ value < 262144, y: finite, not all three 0 }`. X and Z each have to fit the one-byte cell index (`value / 1024 < 256`) that the game packs into `wUnitID`.
  - `{ kind: 'character', world: 1–255, target: characterName (not in names) }`
- `GmLocationInput`: a position destination without `kind`, plus `name` (1–40 characters).

### 4.4 `POST /gm/teleport` steps

1. **Validate** the body. Failures return 400 with field errors, in the existing format.
2. **Position destinations:** run the hosting query from section 2.4. If no row is found, return 422 "No server hosts that location".
3. **Online check:** every name in `names`, plus `target` for a character destination, must be online in `world` (`TCURRENTUSER` joined to `TCHARTABLE` on `dwCharID`, name compared case-insensitively). Otherwise return 409 "Not online: a, b".
4. **Send** the packet through `ControlClient`. `ControlUnavailableError` returns 503 "Game server is not connected".
5. **Audit** by calling `OPTool_ManagerLog`:
   - IP: the request IP with `::ffff:` stripped, cut to 15 characters
   - GM id: the GM's username, cut to 15 characters
   - command: `TELEPORT`
   - details, cut to 1024 characters, e.g. `Kaelith,Moosey -> w1 ch1 map0 (2800,50,5000)` or `Kaelith -> char Moosey`

   Rejected attempts from steps 2–4 are logged too, with a `REJECTED <reason>` prefix. An audit failure is logged to the API console and does not fail the request.
6. **Return** 202.

**Rate limit:** `ThrottlerGuard` on this route allows 30 per minute per IP. The API already forwards the player's IP through the Vite proxy.

### 4.5 Presets file

- `GmLocationsStore` reads the JSON file and validates it as `GmLocation[]`. A missing file is treated as an empty list.
- An invalid file returns 500 "Preset file is invalid" and is not overwritten.
- Writes go to `<file>.tmp` and are then renamed over the file. They are serialised by an in-process promise chain.

## 5. Web

### 5.1 Navigation and access

- The `_authed` header shows a **GM** link when `me.isGm`.
- New route `/_authed/gm/teleport`. Its `beforeLoad` redirects non-GMs to `/characters`.

### 5.2 Teleport page

**Header:** the title "Teleport" and a `StatusBadge` that polls `/gm/status` every 5 seconds:

| State | Label | Style |
|---|---|---|
| connected | Connected | `accent-text` |
| connecting | Connecting… | muted |
| disconnected | Disconnected | danger |
| login-failed | Login failed | danger |

**Players panel**
- A search box filters by name.
- A table with a checkbox per row: Name, Lv, Class, World, Ch, Map.
- A header checkbox selects or clears all visible rows. A count reads "N selected".
- Refetches every 10 seconds, plus a Refresh button.
- Empty state: "No one is online right now."
- Selected players who go offline are dropped from the selection.

**Destination panel:** a `Tabs` component with two tabs.
- **Coordinates:**
  - Presets list: clicking a preset fills the form; each has a delete button with a confirm step.
  - Form fields: World (`Select`), Channel (`Select`), Map ID, X, Height (Y), Z. Uses React Hook Form with the shared schema.
  - **Save as preset** asks for a name inline.
- **Character:** a `Select` of online players who are not selected.

**Send button:** "Teleport N player(s)". It is disabled when nothing is selected, the form is invalid, or the status is not `connected`; in that last case it says why.

**Results**
- 202: an inline note "Sent to a, b. The game doesn't confirm teleports, so check in game." The selection is kept.
- 400, 409, 422, 503: shown through `FormMessage` and field errors, reusing `applyServerError`.

### 5.3 Components

New components, all using the existing tokens:
- `Checkbox`, `Select` and `Tabs`, built on native elements (Tabs uses `role="tablist"` and arrow keys)
- `StatusBadge`

The page also reuses `Button`, `TextField` and `FormMessage`.

## 6. Testing

- **Protocol:** encoding the reference frame gives exactly the bytes in section 2.3. Strings encode as length plus bytes. The decoder handles frames split across chunks and several frames in one chunk, and rejects size < 16.
- **ControlClient** against a fake TControlSvr (a `net.Server` on an ephemeral port):
  - login success sets the status and the worlds
  - login failure gives `login-failed` with no retry
  - the server closing the connection gives `disconnected`, then a reconnect and login again
  - `moveToPosition` sends the exact bytes
  - calls while disconnected throw
- **API**, following the existing controller and service tests:
  - 403 for non-GMs and `isGm` on `/auth/me`
  - 400 for validation errors
  - 422 for an unhosted location
  - 409 for offline names
  - 503 when disconnected
  - 202 sends the packet and writes the audit row
  - preset CRUD and handling of a corrupt file
  - DB-backed tests run against the `_TEST` copies with seeded `TCURRENTUSER` rows that are cleaned up afterwards
- **Web**, with the existing mock API:
  - the GM link appears only for GMs, and a non-GM is redirected
  - filtering and selecting players
  - sending shows the "sent" note
  - each error is displayed
  - presets fill the form and can be saved and deleted
- **Manual:** start TControlSvr, log a character in with the game client, teleport it from the portal, and confirm it moves. The user runs the client.

## 7. Operational notes for the README

- Keep TControlSvr's port 3616 firewalled to localhost.
- Create the `portal` `TMANAGER` account (script in `scripts/db/`) and put its credentials in `.env`.
- TControlSvr must be running and connected to the world server for teleports to arrive. The portal can only report "sent".
