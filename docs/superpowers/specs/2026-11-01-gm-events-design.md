# GM tools: events

Date: 2026-11-01. Status: approved design.

## 1. Goal

Give GMs a page to run EXP, drop and other percentage events, doing what the legacy MFC tool **Happy** does, through the web UI. A GM creates an event with a bonus and a schedule, the game server runs it, and the GM can edit or stop it.

**Who can use it:** the same GMs as the other tools (`GM_USERNAMES`).

**Decisions made with the user:**
- The first version covers the 10 percentage types. Special events that already exist can be seen and stopped, not created or edited.
- Both of Happy's schedule modes are kept: one period and daily.
- No server, database or client changes.

**Out of scope:**
- forms for the 5 special types (cash shop sale, monster spawn, monster regen, item lottery, gift time)
- Happy's separate Lucky Event feature (`CT_EVENTQUARTER*`)
- a history page
- fixing the server bugs in section 2.6

## 2. Facts from the game

From the game source (`C:\Users\stath\Documents\4Story\4s\4Story_5.0_Source - kopie`) and the databases. The portal cannot change these.

### 2.1 The flow

`TControlSvr` owns events. It loads `TGLOBAL_GSP.dbo.TEVENTCHART` at startup into `m_mapEVENT` and never reads the table again, so writing to the table directly does nothing until a restart.

1. Happy sends `CT_EVENTCHANGE_REQ` to `TControlSvr`, which saves through `TEventUpdate` and replies with `CT_EVENTCHANGE_ACK` (`Handler.cpp:1550`).
2. `CheckEvent` runs on every `CT_TIMER_REQ`, once a second (`CTRL_TIMER` is 1000). It sends the start announcement on one tick and turns the bonus on at a later tick (`TControlSvr.cpp:1744`).
3. `TWorldSvr` remembers running events and forwards them to every map server, including map servers that connect later (`TWorldSvr/SSHandler.cpp:263`, `:665`).
4. `TMapSvr` stores the value in `m_wEventValue[type]`.

An event survives restarts. `TControlSvr` reloads it from the table, and sends running events to a world server that reconnects (`SendEventToNewConnect`). If `TControlSvr` is down when an event should end, the bonus stays on until it comes back.

Finished events delete themselves from the table (`CT_EVENTDEL_REQ`), so the portal's audit log is the only lasting history.

### 2.2 Wire format

Same framing as the existing control messages. `CT_CONTROL` is `0x9301`.

| Message | ID | Body |
|---|---|---|
| `CT_EVENTCHANGE_REQ` | `0x9362` | byte kind, event |
| `CT_EVENTCHANGE_ACK` | `0x9363` | byte result, byte kind, event |
| `CT_EVENTLIST_REQ` | `0x9364` | empty |
| `CT_EVENTLIST_ACK` | `0x9365` | word count, then that many events |
| `CT_AUTHORITY_ACK` | `0x9330` | sent instead of the ack when authority is too low |

Kind (`EVENT_KIND`): 0 delete, 1 add, 2 update. Result (`EVENT_RESULT`): 0 success, 1 fail, 2 not found, 3 running, 4 invalid time, 5 max count.

An event (`tagEVENTINFO::WrapPacketIn`, `TControlType.h:195`), in order:

| Field | Type | Notes |
|---|---|---|
| index | dword | 0 on add; the server assigns it and returns it in the ack |
| type | byte | section 2.3 |
| state | byte | non-zero while running |
| groupId | byte | the world; 0 means all worlds |
| serverType | byte | 3 means world server; Happy offers nothing else |
| serverId | byte | 0 means all |
| start | int64 | Unix seconds |
| end | int64 | Unix seconds |
| value | word | the bonus |
| mapId | word | 255 means all maps |
| startAlarm | dword | minutes before start to send the start message |
| endAlarm | dword | minutes before end to send the end message |
| startMessage | string | |
| endMessage | string | |
| title | string | |
| partTime | byte | **1 is one period, 0 is daily** |
| lotteryMessage | string | |
| cash items | word count, then word id and byte sale value | |
| monster start action, end action | byte, byte | |
| spawn IDs | word count, then words | |
| regens | word count, then word monster, dword delay, word map, float x, y, z | |
| lottery | word count, then word item, byte number, word winner | |

`TControlSvr` checks authority before handling a message (lower is stronger): list needs 3 or better, change needs 7 or better. The live `portal` manager has authority 3.

### 2.3 Types and what the value does

From `NetCode.h:2427`. All percentage values are a +N% bonus, so 100 means double.

| ID | Type | Effect | Maps |
|---|---|---|---|
| 1 | EXP | EXP from kills × (1 + N/100), before the fixed ×36 multiplier | all |
| 3 | Item drop | Adds `bItemProb × N/100` to each drop roll's chance | one or all |
| 4 | Magic item drop | Magic chance × (1 + N/100) | one or all |
| 5 | Refine | Adds `base × N/100` to the chance, 100% at most | all |
| 6 | Refine transfer | Same | all |
| 7 | Item upgrade | Same | all |
| 8 | Magic upgrade | Same | all |
| 9 | Rare magic upgrade | Same | all |
| 10 | Gamble option | Same | all |
| 11 | Money drop | Money × (1 + N/100), before the fixed ×50 multiplier | one or all |

Special, not editable here: 2 cash shop sale, 12 monster spawn, 13 monster regen, 14 item lottery, 15 gift time.

### 2.4 Schedule rules

- **One period (`partTime` 1):** on from start to end.
- **Daily (`partTime` 0):** on during the same time window each day of the date range. The window is compared as minutes of the day, so one that crosses midnight never turns on.
- Hours and minutes are read in the server's local timezone. `TEVENTCHART` stores `smalldatetime`, so only whole minutes survive a restart.
- An end time already past, or not after start, is refused with result 4. A start time in the past is accepted, which is how an event starts now.
- Only one event of a type can be on at once. The server refuses (result 4) an event of the same type whose date range overlaps another's, bounds included. Two daily events pass if their time windows don't overlap either, again bounds included.
- With `endAlarm` 0 on a one period event, the end message is only sent if a one-second tick lands exactly on the end second, so it can be skipped.

### 2.5 Announcements

Messages reach players as world chat from the Operator (`OnMW_EVENTMSG_REQ`). The server sends them even when blank, so a blank message shows an empty line. Each is sent once per run.

With `groupId` 0 they go to the relay server, whose source isn't in our tree. With a specific world they go through `TWorldSvr` to every map server, so the portal always targets a specific world. There is one today: Lapiris (1).

### 2.6 Server behaviour the portal must work around

These are in `OnCT_EVENTCHANGE_REQ` and Happy gets several of them wrong.

| Behaviour | Result if ignored | Portal rule |
|---|---|---|
| The title is copied with `lstrcpy` into `m_strTitle[MAX_NAME + 1]`, 51 characters. Happy allows 255. | Memory corruption in `TControlSvr` | Title is 50 characters at most |
| Editing a running event sends value 0 and then stores the state from the packet. | If the packet says running, the bonus stays off until the end | Always send state 0 on update, so `CheckEvent` restarts it |
| The stop message for an edited event uses the **new** type and world from the packet. | Changing a running event's type or world leaves the old bonus on until a map server restart | Type and world can't be changed on edit |
| Update and delete use the event in the packet, including special fields like spawn IDs. | A special event stops wrongly, and an update for a gone index creates it again | Read the current event first, return 404 if it's gone, and send it back unchanged |
| Happy sends map 0 for a blank map field, and map 0 is a real map. | The bonus only applies on that map | "All maps" sends 255 |
| `Handler.cpp:1676` reads `(*it)` where `it` can be `m_mapEVENT.end()` on add. | Undefined behaviour. Happy takes the same path, and at worst it sends value 0 for that type. The first live check covers it. | None; recorded here |

`szTitle` in `TEventUpdate` is also `VARCHAR(50)`, and messages are `VARCHAR(1024)`. `wValue` and `wMapID` are `smallint`, so 32767 is the largest usable value.

## 3. Web

A new **Events** link in `GmNav` and a page at `/gm/events`. The page shows the connection badge like the other GM tools. While the control server isn't connected, the list can't load, and the page says so and turns off changes.

### 3.1 List

Refreshes every 5 seconds, because status changes on its own.

| Column | Content |
|---|---|
| Title | |
| Type | |
| Bonus | `+100%`. Blank for special events. |
| Map | `All maps` or the map name, only for drop types. |
| Schedule | `6 Nov 18:00 → 8 Nov 23:00`, or `Daily 20:00–22:00, 1–7 Nov`. |
| Status | `Running` or `Waiting` |
| Actions | `Edit` and `Stop` (or `Delete` when not running). Special events have no `Edit`. |

Stop and Delete ask for confirmation in the row, like `LoginsTable`. The text for a running event says the bonus ends now. There is no pause: both remove the event for good.

An empty list says so, with a button to create an event.

### 3.2 Form

Used for create and edit, opened above the list.

- **Type:** the 10 percentage types. Locked on edit, with a note to stop it and create a new one instead.
- **World:** only shown when there is more than one, and locked on edit.
- **Title:** 1 to 50 characters.
- **Bonus:** 1 to 1000. A line beside it explains the current value in the type's terms, such as `+100% = double EXP`, or for chance types `+100% = double the chance, up to 100%`.
- **Map:** only for the three drop types. `All maps` is the default. The options come from `/gm/places`.
- **Schedule:** a choice of `One period` or `Daily`.
  - One period: start and end date and time, and a `Start now` button that fills start with the current server time.
  - Daily: start and end date, and a daily from and to time.
  - Labelled `Server time`, with the current server time shown. Times are never converted to the browser's timezone.
- **Announcements:** start and end messages, 1 to 200 characters, each with minutes before. Start defaults to 0 and end to 1, its minimum.
  - On create, the messages are generated from the type, bonus and minutes until the GM edits them: `EXP +100% event has started!`, `EXP +100% event ends in 1 minute.`
- **Save.** Editing a running event shows a warning first: saving restarts it, so players see the start message again and the bonus drops out for a second or two.

Field errors from the shared schema appear on the fields. API errors appear above the buttons.

## 4. API

Under the existing `SessionGuard` and `GmGuard`, with the vendor tool's write throttle (30 a minute).

| Route | Success | Purpose |
|---|---|---|
| `GET /api/gm/events` | 200 `{ serverNow, events }` | The list from `TControlSvr`, and the server's clock |
| `POST /api/gm/events` | 201 event | Create |
| `PUT /api/gm/events/:index` | 200 event | Edit a percentage event |
| `DELETE /api/gm/events/:index` | 204 | Stop or delete any event |

### 4.1 Times

Between web and API, times are server wall clock strings, `YYYY-MM-DDTHH:mm`, with no timezone. The API converts them using its own timezone, which relies on the API running on the same machine as `TControlSvr` (`CONTROL_HOST` is `127.0.0.1`). `serverNow` is the same format.

### 4.2 Request

```ts
{
  type: 1 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11,
  world: number,
  title: string,
  bonus: number,
  mapId: number | null,        // null is all maps
  schedule: { mode: 'period' | 'daily', start: string, end: string },
  startMessage: string,
  endMessage: string,
  startNoticeMinutes: number,
  endNoticeMinutes: number,
}
```

For daily, `start` and `end` hold the first date with the from time and the last date with the to time, which is what the server expects.

Rules, in `packages/shared` so API and browser agree:

- `title` is 1 to 50 and messages are 1 to 200 characters after trimming. All must be printable Latin-1, because the protocol's strings are Latin-1 bytes. Greek, for example, is refused rather than garbled.
- `bonus` is a whole number from 1 to 1000.
- `mapId` must be null unless the type is a drop type. Otherwise null, or 0 to 32767 but not 255, which means all maps.
- `start` and `end` must be real dates in the format above, with `end` after `start`.
- Daily: the time of day of `end` must be after that of `start`.
- `startNoticeMinutes` is 0 to 1440, and `endNoticeMinutes` 1 to 1440 and less than the event's length (the window for daily).

Rules in the service:

- `end` must be after the server's current time (422).
- `world` must be one of the worlds from `control.status()` (422).
- On edit: the event must exist (404), must be a percentage type (422), and `type` and `world` must match it (422).

The API always sends `serverType` 3, `serverId` 0, `state` 0, and map 255 for types that have no map. Special fields stay empty on create and edit, and `DELETE` sends the event as it was listed, unchanged.

### 4.3 Event in responses

```ts
{
  index: number,
  type: number,
  typeName: string,            // `Type 16` for an ID we don't know
  editable: boolean,           // percentage type
  running: boolean,
  world: number,               // 0 is all worlds
  title: string,
  bonus: number | null,        // null for special types
  mapId: number | null,        // null is all maps, and for types with no map
  schedule: { mode, start, end },
  startMessage: string,
  endMessage: string,
  startNoticeMinutes: number,
  endNoticeMinutes: number,
}
```

### 4.4 Errors

| Situation | Status | Message |
|---|---|---|
| Not connected | 503 | `Game server is not connected` |
| No reply in 5 seconds | 503 | `The game server did not reply. The change may or may not have applied, so check the list.` |
| `CT_AUTHORITY_ACK` | 503 | `The portal's control account does not have enough authority for events` |
| Result 4 | 409 | `Overlaps <title>: only one <type> event can be on at a time.` The title is found by listing events and applying the overlap rule. Without a match: `The game server refused those times.` |
| Other non-zero result | 502 | `The game server could not save the event` |
| Event not found | 404 | `That event has already ended or been removed` |
| Editing a special event | 422 | `Special events can only be stopped` |
| Unreadable reply | 502 | `The game server sent a reply the portal could not read` |

The web shows the API's message for anything under 500, and for 502 and 503, because all of these are written for the GM.

### 4.5 Audit

Every create, edit, stop and refusal is written with `writeAudit`, command `EVENT`, in the teleport tool's format:

```
ADD #4 EXP +100% maps=all period 2026-11-06T18:00 to 2026-11-08T23:00 "Weekend EXP"
STOP #4 EXP "Weekend EXP" running
REJECTED overlap: ADD Item drop +50% ...
```

A failed audit write only logs a warning, as elsewhere.

## 5. Control client

`control-protocol.ts` gains the messages above, `BodyWriter.int64`, and `BodyReader.word`, `.float` and `.int64`. `ControlEvent` holds every wire field, so a listed event can be sent back byte for byte.

`ControlClient` only sends today, so it gains `listEvents()` and `changeEvent(kind, event)`, both on a private `request()`:

- **One at a time.** Replies have no request ID, so requests go through a queue.
- **Matching.** A reply counts if its message ID matches and, for a change, its kind, type and title match. Any other frame is ignored, so a late reply to a timed-out change can't answer the next one.
- **Timeout.** 5 seconds, then `ControlTimeoutError`.
- **Disconnect.** Rejects the pending request and everything queued with `ControlUnavailableError`.
- **Refusal.** `CT_AUTHORITY_ACK` while a request is pending rejects it with `ControlRefusedError`.
- **Decoding.** A reply that can't be decoded rejects that request with `ControlBadReplyError`. It does not close the socket as other bad frames do, because the framing is still sound and teleports depend on this connection.

The login warning changes to report that events need authority 3 or better.

## 6. Testing

`npm test` never touches a database or a real control server.

- **Protocol:** encoding compared with hand-written bytes in the C++ field order, decoding of a list holding every special field, and a special event round-tripped unchanged.
- **Client:** the fake server in `control-client.test.ts` covers reply matching, a late reply being ignored, timeouts, the queue, disconnects, refusals and an unreadable reply leaving the socket up.
- **Shared schema:** each rule in 4.2.
- **Service:** kinds and fixed fields, state 0 on edit, unchanged special events on stop, time conversion, the overlap lookup, every error in 4.4, and audit lines.
- **HTTP:** guards, status codes and validation through `createTestApp`.
- **Web:** page tests like `gm-logins.test.tsx`, including the form's rules, generated messages, locked fields, the running warning and confirmation.

### 6.1 First live check

`TControlSvr` runs against live and `TGLOBAL_GSP_TEST` has no `portal` manager, so the real server can only be exercised on live. A second `portal` login drops both sessions, so this goes through the one API that's connected, after the branch is merged and it has restarted:

1. Create `+1%` EXP for 5 minutes, starting now.
2. Confirm it shows `Running`, the start message appears in game, and a row is in `TEVENTCHART`.
3. Edit it to `+2%` and confirm it returns to `Running`.
4. Stop it, and confirm the status and row are gone and the end of the bonus by a kill's EXP.

This is normal use of the tool, not a game change, so it needs no ledger entry unless it finds something.
