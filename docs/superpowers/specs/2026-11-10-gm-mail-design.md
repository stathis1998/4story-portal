# GM tools: mail

Date: 2026-11-10. Status: approved design, awaiting spec review.

## 1. Goal

GMs can only give items or gold today by editing the database by hand. Give them a portal page that sends in-game mail to one or more characters, online or offline. Each letter can carry up to 3 items and some gold, and both are optional. Players pick it up from the in-game mailbox like any other letter.

This is the base for a later feature: when the server-wide shared EXP goal is reached, the reward will go out through the same path to every character.

**Who can use it:** the same GMs as the other tools (`GM_USERNAMES`).

**Decisions made with the user:**
- Items and gold are optional. A letter may carry items, gold, both, or neither.
- A send goes to one or more named characters (1 to 20). Each gets their own letter.
- Letters use the Operator mail type (6).
- 0 to 3 items per letter, item and count only.
- Gold is capped at 10,000 gold per letter.
- Mailed items keep their chart's normal trade rules. They are not wrapped.

**Out of scope:**
- sending to every character (that comes with the shared-goal reward)
- item options: grade, refine, magic options, expiry, wrap
- an in-game "new mail" pop-up for players who are online
- the 20-letter mailbox limit (GM mail ignores it, as the original operator tool does)
- game server or client changes

## 2. Facts from the game

From the game source (`C:\Users\stath\Documents\4Story\4s\4Story_5.0_Source - kopie`) and the live `TGAME_GSP` (read only). The portal cannot change these.

### 2.1 Where mail lives

- `TPOSTTABLE` holds one row per letter. Its key is `dwPostID`, an identity column, and the recipient is `dwCharID`.
- Attached items are ordinary `TITEMTABLE` rows with `bStorageType = 2`, `dwStorageID = dwPostID`, `bOwnerType = 0` and `dwOwnerID = dwCharID`. `TPOSTITEMTABLE` is not used.
- New item IDs come from `EXEC TGenerateDBItemID @dlID OUTPUT`.
- Title and message are stored with an 8-character hex length prefix: `RIGHT(master.dbo.fn_sqlvarbasetostr(CAST(DATALENGTH(@s) AS BINARY(4))), 8) + @s`. Both `OPTool_GamePost` and `TEventItemGiveByPost` do this.

### 2.2 The map server reads mail from the database every time

`OnCS_POSTLIST_REQ` and `OnCS_POSTVIEW_REQ` (`TMapSvr\CSHandler.cpp`) query the database each time (`TPostView`), with no cache. So a letter inserted directly shows up for offline players at their next login, and for online players the next time they open the mailbox.

`OnCS_POSTGETITEM_REQ` moves all attached items into the inventory at once, refusing with `POST_INVENFULL` if they do not fit. It then pays out `CalcMoney(dwGold, dwSilver, dwCooper)` and calls `TPostGetItem`, which zeroes the money and deletes the item rows.

### 2.3 Money

`CalcMoney = copper + silver * 1000 + gold * 1000 * 1000` (`MONEY_MULTIPLY = 1000`, `Lib\Own\TProtocol\include\NetCode.h`). In game these are Rune, Luna and Cron.

### 2.4 Mail types

`POST_TYPE` in `NetCode.h`: 0 normal, 1 package, 2 bills (cash on delivery), 3 return, 4 payment, 5 NPC, 6 operator, 7 cash. The client lists type 6 as an operator letter (`TMailListFrame.cpp`).

- Type 2 must never be used: it asks the recipient to pay.
- `TSavePost` treats type 1 with more than 10 gold as suspicious and logs it to `TPOSTERRORTABLE`. Type 6 avoids that check.

### 2.5 Items

- The client shows up to 3 attachments per letter (`TMAIL_ITEM_MAX = 3`, `Client\TClient\TClientType.h`).
- Live non-expiring items have `dEndTime = '1900-01-01'` and usually `bLevel = 0`.
- `bCount` is `tinyint`. `TITEMCHART.bStack` is the stack size, where 0 means 1 (190 chart rows have 0).
- Whether an item can be traded comes from `TITEMCHART.bIsSell & ITEMTRADE_DEAL`, or the per-item wrap flag (`dwTime2`). This feature leaves wrap at 0.

### 2.6 Limits

`MAX_BOARD_TITLE = 256` and `MAX_BOARD_TEXT = 2048` include the 8-character prefix. Names are at most 50 characters (`MAX_NAME`).

## 3. Database: `TPortalGmPost`

A new procedure in `TGAME_GSP`, added by `C:\Users\stath\Documents\4Story\4s\db_changes\2026-11-10-portal-gm-mail\apply.sql`. `undo.sql` drops it. Both run against `TGAME_GSP_TEST` first. The live database gets them only when the user says so.

```
TPortalGmPost
  @pCharID INT,
  @pSender VARCHAR(50), @pTitle VARCHAR(240), @pMessage VARCHAR(2000),
  @dwGold INT, @dwSilver INT, @dwCooper INT,
  @wItemID1 SMALLINT, @bCount1 TINYINT,
  @wItemID2 SMALLINT, @bCount2 TINYINT,
  @wItemID3 SMALLINT, @bCount3 TINYINT
RETURNS (return value) the new dwPostID, or 0 if nothing was written
```

Behaviour, all inside one transaction (`SET XACT_ABORT ON`):

1. Look up `szName` in `TCHARTABLE` for `@pCharID` with `bDelete = 0`. If none, return 0.
2. Insert the `TPOSTTABLE` row: `bType = 6`, `bRead = 0`, `dwSendID = 0`, `szRecvName` set to the name, the length-prefixed title and message, the gold columns as passed, and `timeRecv = GETDATE()`.
3. For each item slot whose ID is not 0: read `dwDuraMax` from `TITEMCHART`, get an ID from `TGenerateDBItemID`, and insert the `TITEMTABLE` row as in 2.1. Use `bItemID = 0`, `bLevel = 0`, `bGLevel = 0`, `dwDuraCur = dwDuraMax`, `bRefineCur = 0` and `dEndTime = '1900-01-01'`, and set every magic, value, time, `bGem`, `wMoggItemID` and `bGradeEffect` to 0.
4. Commit and return the post ID.

The procedure trusts its inputs. All validation happens in the API (section 4), so the procedure stays a thin, faithful copy of the game's own mail procedures.

It deliberately writes no audit row. `OPTool_GamePost` calls `TGLOBAL_GSP.dbo.OPTool_ManagerLog` by a hardcoded name, so a copy run in `TGAME_GSP_TEST` would write into the live global database. The API writes the audit through the existing `writeAudit`, which takes table names from config (section 4.3).

The procedure is `CREATE OR ALTER` and lives in the portal repo at `apps/api/sql/TPortalGmPost.sql`. The `db_changes` `apply.sql` contains the same text.

## 4. API

`POST /gm/mail` in a new `MailController` (`@Controller('gm')`, `SessionGuard`, `GmGuard`, `ThrottlerGuard` with 30 requests per minute, like teleport).

### 4.1 Request (`gmMailRequestSchema` in `packages/shared`)

```ts
{
  recipients: string[];           // 1..20 names, trimmed, deduped case-insensitively, each 1..50 chars
  sender?: string;                // default "[GM]", 1..20 chars
  title: string;                  // 1..200 chars
  message: string;                // 0..2000 chars
  money?: { gold: number; silver: number; copper: number }; // integers; gold 0..10000, silver/copper 0..999
  items?: { itemId: number; count: number }[];              // 0..3 entries; itemId 1..32767; count 1..255
}
```

Text fields accept printable ASCII and newlines only. The game columns are `VARCHAR`, and the portal already writes strings as latin1 elsewhere.

### 4.2 Service checks, before anything is written

1. Resolve every recipient name, case-insensitively, against `TCHARTABLE` rows with `bDelete = 0`. If any are unknown, return 422 listing them and send nothing.
2. Look up every item in `TITEMCHART`. If any are unknown, return 422. If a count is above `max(bStack, 1)`, return 422 naming the item and its stack size.

### 4.3 Sending

For each resolved recipient, in order, call `TPortalGmPost` with that character's ID.

- A failure for one recipient (an error or a return of 0) is recorded and the rest still go out. Each letter is its own transaction, so a failure never leaves a half-written letter.
- Response `200`: `{ results: { name: string; postId: number | null; error?: string }[] }`.
- If every recipient failed, the status is still 200. The web page shows the errors per recipient.

Audit: through the existing `writeAudit` with command `POST`, as `TeleportService` does. A failure to write the audit is logged as a warning and doesn't fail the send.
- Each sent letter gets `<name>(<charId>) post <id> "<title>" items: <id>x<count>,... money: <g>/<s>/<c>`.
- Each failure for one recipient gets `FAILED <name>: <error>`.
- A 422 gets `REJECTED <reason>: <summary>`.

### 4.4 Item search for the composer

`GET /gm/items?q=&shop=` exists for vendors but needs a shop. Make `shop` optional. Without it, the search returns all matching items with no shop filter, plus `stack` (the `max(bStack, 1)` value) so the web page can cap the count.

## 5. Web

A new route `apps/web/src/routes/_authed/gm/mail.tsx`, listed in the GM navigation next to Teleport, Events, Logins and Vendors.

- **Recipients:** a text box that turns typed names into removable chips (Enter or comma), up to 20. Unknown names come back from the API and are highlighted.
- **Sender** (prefilled with `[GM]`), **title**, **message**.
- **Items:** up to 3 rows. Each row has an item search (reusing the vendor page's search component and icons) and a count input capped at the item's stack. Rows can be added and removed.
- **Money:** three number inputs labelled Rune, Luna and Cron, all defaulting to 0.
- **Send** opens a confirmation summary: recipients, items with counts, and money. Confirming posts the request. The page then shows the result for each recipient (post ID or error) and keeps the form filled for a resend.

## 6. Testing

Light, per the VM rule: run only the touched test files, once.

- **Database** (`apps/api/test/db/mail.db.test.ts`, against `TGAME_GSP_TEST`). Each case runs in the usual rolled-back transaction, and it first runs `apps/api/sql/TPortalGmPost.sql` inside that transaction, so `_TEST` is left unchanged afterwards:
  - a letter with no attachments
  - gold only
  - 3 items, checking the `TITEMTABLE` rows are linked to the letter
  - a missing or deleted character returns 0 and writes nothing
  - the title prefix matches the game's format
- **Unit** (`mail.service.test.ts`): unknown names or items return 422 and nothing is sent, the stack cap is enforced, and a failure for one recipient doesn't stop the others.
- **HTTP** (`gm-mail.http.test.ts`): GM-only access, schema rejections, the response shape.
- **Web** (`mail.test.tsx`): chip entry, the item row limit, the confirmation summary.
- **Manual, once, after the user approves applying to live:** send a letter with 2 items and gold to a test character while online, open the mailbox, take the attachments, then check the inventory and money.

## 7. Delivery

- Branch `feat/gm-mail` in the worktree `.worktrees/gm-mail`, created from `main`.
- The procedure source is `apps/api/sql/TPortalGmPost.sql` in the portal repo. `C:\Users\stath\Documents\4Story\4s\db_changes\2026-11-10-portal-gm-mail\apply.sql` has the same text, and `undo.sql` drops the procedure, matching earlier database changes.
- Add an entry to `C:\Users\stath\Documents\4Story\4s\GAME_CHANGES_LEDGER.md` when finished, saying what was and wasn't verified.
- Merging to `main` makes it live, because `main` runs under `dev:host`. Merging and applying to the live database are both separate decisions for the user.
