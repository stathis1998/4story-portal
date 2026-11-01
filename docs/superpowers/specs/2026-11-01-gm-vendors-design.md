# GM tools: vendors

Date: 2026-11-01. Status: approved design, awaiting spec review.

## 1. Goal

Editing vendor stock and prices through SQL is slow and error prone. Give GMs a page where they search for a vendor, click it, and see what it sells, with game icons for vendors and items. From there they can change prices, remove items from the vendor, and add new ones.

A helper script extracts the icons from the game client, so neither the API nor the web app needs the client installed.

**Who can use it:** the same GMs as the other tools (`GM_USERNAMES`).

**Decisions made with the user:**
- Prices stay global to the item. There are no per-vendor prices and no game server changes.
- GMs enter the actual price (Rune, Luna, Cron or PvP points), not the stored multiplier.
- Generated PNGs and the ID lookup are committed to the repo.

**Out of scope:**
- reloading a running server, or the portal restarting `TMapSvr`
- patching the client's `TItem.tcd`
- editing vendor discounts (no vendor uses one today)
- bulk edits
- editing any item field other than the price

## 2. Facts from the game

From the game source (`C:\Users\stath\Documents\4Story\4s\4Story_5.0_Source - kopie`), the client install (`Araz4Story PvP`) and the `_TEST` database. The portal cannot change these.

### 2.1 Who is a vendor

`TNPCCHART.bType` is `TNPC_TYPE` in `Lib/Own/TProtocol/include/NetCode.h`. `TNPCITEMCHART.dwItemID` means something different per type (`TMapSvr.cpp`, `LoadData`): skill IDs for skill NPCs, a portal ID for portals, a spawn ID for return NPCs. It holds item IDs only for these two types, which are the vendors:

| bType | Name | Pays with | NPCs |
|---|---|---|---|
| 2 | `TNPC_ITEM` | money | 89 |
| 21 | `TNPC_PVPOINT` | PvP points | 7 |

Type 25 (`TNPC_MAGICITEM`) is not a vendor for this tool: 151 of its 190 rows are not in `TITEMCHART`, so its IDs refer to something else.

### 2.2 Stock

`TNPCITEMCHART` has only `wNpcID smallint` and `dwItemID int`, with both as the primary key. No price or order is stored.

### 2.3 Prices

Prices live on `TITEMCHART` as multipliers (`fPrice`, `fPvPrice`, SQL `float`, read into a C++ `FLOAT`):

```
level = TITEMATTRCHART.bGrade for wAttrID   when wAttrID <> 0 (0 if the attribute row is missing)
      = TITEMCHART.bLevel                   otherwise
base  = TLEVELCHART.dwMoney (or dwPvPMoney for a PvP vendor) at that level, 0 if there is no such row
price = DWORD(base * multiplier + 0.99)     where base * multiplier is 32-bit float arithmetic
```

Source: `CTMapSvrModule::GetItemPrice` and `GetItemPvPrice`. Level 0 has base 0, so no multiplier can give those items a price.

Consequences:
- A price change applies at every vendor selling the item.
- The server pays `CTItem::GetPrice() / 4` when a player sells to any vendor, and that is computed from `fPrice`, so sell-back moves with the money price. For items with attributes, `GetPrice` uses the instance's power level, so an upgraded item sells for more than the formula here shows.
- The buy handler computes `price * count` in a `DWORD`, so a large enough price wraps around and becomes cheap.
- Money is displayed as `Rune = price / 1,000,000`, `Luna = (price % 1,000,000) / 1,000`, `Cron = price % 1,000`.

### 2.4 Client behavior

- The shop list and its prices come from the server (`CS_NPCITEMLIST_ACK`), so the buy price needs no client change.
- The list handler dereferences `CTChart::FindTITEMTEMP(wItemID)` with no null check. **An item in a shop but not in the client's `TItem.tcd` crashes any player opening that shop.** Today 4 DB items are missing from the client (60, 19096, 19097, 19098), and none is sold.
- The client's sell-price tooltip uses `TItem.tcd`'s rate (`TDetailInfo.cpp:871`), so after a price change it shows the old value while the server pays the new one. This is accepted and documented in the README.

### 2.5 Shop size

`SendCS_NPCITEMLIST_ACK` writes the count as a `BYTE` after filtering per player. An item is included when:

- `dwClassID` has the player's class bit, and
- `bItemCountry` is `TCONTRY_N` (3) or the player's country, or the NPC's `bCondition` is `DCC_ALLCOUNTRY` (4).

Over 255 items wraps the count, so the shop appears empty or cut short for that class. The largest view today is 150 (NPC 26009).

### 2.6 When changes take effect

`TMapSvr` reads these charts in `LoadData` at startup. No reload command exists for them (the only chart update packet is for the gift chart). Edits reach players after every `TMapSvr` restarts.

### 2.7 Icons

The `Extractor` folder in the source tree already implements the image decoding and is the reference for it. It is outside this repo and not under git, so its logic is ported rather than depended on.

**Item icon:** `TItem.tcd` `Visual0` → `TItemVisual.tcd` `Icon` (a UI list index) → list `0x2169` in `TClientCmd.tif` → sprite ID. Using `Visual0` matches `CTClientItem::GetDefaultVisual`, which the shop uses.

**Vendor portrait:** `TNPC<8 hex>.tcd` or `TNPCGlobal.tcd` (`CTChart::ReadTNPC`: `DWORD id`, `WORD tempId`, …) → `TNPCTemp.tcd` `m_wFaceIcon` (`InitTNPCTEMP`) → list `26269` (`0x669D`) in `TClientCmd.tif` → sprite ID. Checked by eye: vendors titled "Elfish Consumer Goods Trader" have face 38, a green-haired elf.

**Sprite pixels:** `Index/TClientI.IDX`, `Index/TClientList.LST`, `Data/Img/*.TIM`, `Data/Img/*.TIS`. Item sprites are 32×32, faces 36×36.

**Measured coverage:**
- 7,158 of 7,775 client items resolve to an icon, using 1,912 unique sprites (about 4.2 MB). Of the 933 items currently sold, 1 has no icon.
- 87 of 96 vendors have a portrait. Of the other 9, 1 is in no client NPC file, and 8 have a missing template or face 0.

**Chart file quality:** the client skips unreadable `TNPC` unit files silently (`LoadTNPC` catches everything). Several are older layouts or empty: `TNPC00000004`, `TNPC00000101`, `TNPC00002202`, `TNPC03850000` to `TNPC038a0000`. Others in the folder are not unit files at all (`TNPCPOS.tcd`, `TNPC02bf00000.tcd`).

## 3. Icon import

`npm run import:icons -w apps/api`, split like `import:places`:

- `apps/api/src/gm/game-icons-import.ts`: pure parsing and decoding of buffers, no I/O.
- `apps/api/src/gm/import-game-icons.ts`: thin script doing the file reads and writes.
- `apps/api/src/gm/game-places-import.ts` exports its `ArchiveReader`, so both importers share it.

The client root is the parent of the existing `GAME_TCD_DIR`, so no new setting is needed. `pngjs` is added as a dev dependency of `apps/api`.

**Output:**
- `apps/web/public/game-icons/<spriteId>.png`: only the sprites referenced by an item or NPC. The filename is the sprite ID, so items sharing an icon share a file. These are served publicly, which is fine for game art.
- `apps/api/src/gm/game-icons.generated.ts`: `itemIcons`, mapping **every item in `TItem.tcd`** to a sprite ID or `null`, and `npcFaces`, mapping NPC ID to sprite ID.

`itemIcons` doubles as the client item list: an item ID that is not a key is not in the client. That is what the add-item check uses.

**Parsing rules:**
- `TItem.tcd`, `TItemVisual.tcd` and `TNPCTemp.tcd` are strict: leftover bytes or a read past the end fail the run.
- NPC files are best effort, like the client. Only `TNPCGlobal.tcd` and names matching exactly `TNPC` + 8 hex digits are read. A file that fails or has leftover bytes keeps the records read before the failure and is reported as a warning.

**Running:**
- It stops with a clear error if `GAME_TCD_DIR` is unset.
- It writes nothing until everything has parsed, so a failed run leaves the existing icons in place.
- It deletes PNGs no longer referenced, only inside `game-icons/`.
- It prints counts at the end: items, items with no icon, NPC faces, files written and removed, and skipped NPC files.

After a client update, re-run it and restart the API.

## 4. API

`VendorsController`, `VendorsService` and `VendorsRepository` in `apps/api/src/gm/`, registered in `GmModule`. All routes use `SessionGuard` and `GmGuard`. Writes use `ThrottlerGuard` with the limit the other GM writes use (30 per minute). New tables go in `tableNames`: `npcs` (`TNPCCHART`), `npcItems` (`TNPCITEMCHART`), `items` (`TITEMCHART`), `itemAttrs` (`TITEMATTRCHART`), `levels` (`TLEVELCHART`).

Names come from the database (`szNAME`, `szName`, `NC_szName2`). A name of `_` counts as empty.

### 4.1 Endpoints

| Route | Purpose |
|---|---|
| `GET /gm/vendors` | Returns `{ database, vendors }`. `database` is `DB_GAME_NAME`. Each vendor has ID, name, title, shop type (`money` or `pvp`), country, map ID, map name, item count and portrait sprite ID. |
| `GET /gm/vendors/:id/items` | The vendor's stock. Each row has item ID, name, level, icon sprite ID, price, base and sold-by count. |
| `POST /gm/vendors/:id/items` | Body `{ itemId }`. Adds the item to this vendor. |
| `DELETE /gm/vendors/:id/items/:itemId` | Removes the item from this vendor only. Returns 204. |
| `PUT /gm/items/:itemId/price` | Body `{ currency: 'money' \| 'pvp', amount }`. Returns the new price, multiplier and sold-by count. |
| `GET /gm/items?q=` | Item search by name or exact ID, up to 50 results. Each row has ID, name, level, icon, money price, PvP price and whether it is in the client. |

The vendor list is small enough to filter in the browser.

Sold-by counts only count vendors (types 2 and 21), because other NPC types use the same IDs for other things. Stock rows whose item is not in `TITEMCHART` appear as `Unknown item #<id>` with no price, so they can be removed. None exist on vendor types today.

### 4.2 Price functions

Pure functions in `packages/shared`, so the API and the browser preview cannot disagree:

- `chargedPrice(base, multiplier)`: `Math.trunc(Math.fround(Math.fround(base) * Math.fround(multiplier)) + 0.99)`.
- `multiplierForPrice(base, amount)`: starts at `Math.fround(amount / base)` and tries neighboring float values, returning the first whose `chargedPrice` equals `amount`, or else the one that gets closest. The result can miss by a little at very large prices (a float has 24 bits of precision), so callers check what `chargedPrice` returns. An amount of 0 returns multiplier 0.
- `sellBackPrice(price)`: `Math.floor(price / 4)`.
- `splitMoney(price)` and `joinMoney({ rune, luna, cron })`.

The stored multiplier is the 32-bit float value, so the database holds exactly what the server will read.

### 4.3 Rejections

| Case | Status | Message says |
|---|---|---|
| Vendor missing, or not type 2 or 21 | 404 | That NPC is not a vendor |
| Removing an item the vendor doesn't sell | 404 | Not sold by this vendor |
| Pricing an item that doesn't exist | 404 | Item not found |
| Adding an item not in `itemIcons` | 422 | Not in the game client, adding it would crash players opening this shop |
| Adding an item not in `TITEMCHART` | 422 | Not in the game database, the server would ignore it |
| Item already sold by this vendor | 409 | Already sold by this vendor |
| Adding would exceed 255 in any view | 422 | Would exceed the 255 item shop limit for `<class>` in `<faction>` |
| Base is 0 | 422 | This item's level has no price, so it can't be set |
| `amount * max(bStack, 1)` over 4,294,967,295 | 422 | Price too high, buying a full stack would overflow |

`amount` is validated by Zod as an integer from 0 to 4,294,967,295.

The 255 check counts, for each of the 6 classes and for countries 0 and 1, the vendor's stock plus the new item using the filter in section 2.5. Vendors with a higher existing count don't exist today, and removing items is always allowed.

### 4.4 Concurrency

Adding an item another GM just added hits the primary key and returns 409. Removing one already gone returns 404. Prices are last write wins; the audit keeps every old and new value. No locking.

### 4.5 Audit

Every write calls the existing `writeAudit` (`OPTool_ManagerLog`). A failed audit is logged as a warning and doesn't fail the request, as in `LoginsService`.

| Command | Log |
|---|---|
| `VENDORADD` | `Mr Bab (20002): +8001 Small Vitality Potion` |
| `VENDORDEL` | `Mr Bab (20002): -8001 Small Vitality Potion` |
| `ITEMPRICE` | `8001 Small Vitality Potion: fPrice 50 -> 75, 50 -> 75 cron` |

## 5. Web

Route `/gm/vendors` with a `vendor` search param (`?vendor=20002`), so a vendor is linkable and survives a refresh. It has the same `beforeLoad` GM check as the other GM pages. "Vendors" is added to `GmNav`.

Components in `apps/web/src/components/gm/`: `VendorList`, `VendorItemsTable`, `PriceEditor`, `AddItemSearch`, `GameIcon`. Queries and mutations go in `apps/web/src/lib/gm.ts`.

### 5.1 Page

Two panes that stack on narrow screens:

```
Vendors
Editing TGAME_GSP_TEST. Players won't see this test copy.
Changes reach players after TMapSvr restarts.

┌ Search vendors ─────┐  ┌─────────────────────────────────────────────┐
│ [ dorosi          ] │  │ [face] Mrs Dorosi                           │
│ ☐ PvP shops only    │  │ Consumer goods tradesman · Defugel · Map 0  │
│                     │  │                                 [+ Add item]│
│ [face] Mrs Dorosi   │  │ Filter stock [        ]                     │
│  Consumer goods  10 │  │                                             │
│ [face] Mr Bab       │  │ Item              Lv  Price         Sold by │
│  —               10 │  │ [i] Small Potion   1  0R 0L 50C    12   ✎ 🗑 │
│ [face] Elrod        │  │ [i] Derion Cloth   1  0R 5L 0C      3   ✎ 🗑 │
└─────────────────────┘  └─────────────────────────────────────────────┘
```

- The first banner line appears only when `database` ends in `_TEST`. The restart line is always shown.
- `GameIcon` builds `/game-icons/<spriteId>.png`, sets `loading="lazy"`, and shows a neutral placeholder when the sprite ID is `null` or the image fails to load.
- **Vendor list:** filters as you type on name, title or ID, and has a PvP-only checkbox. Rows show the portrait, name, title and item count. A vendor with no name shows its title as the name.
- **Stock table:** filters in the browser. Money prices are shown as Rune, Luna and Cron, and PvP shops show points. A price of 0 shows as `Free`, since an item with no multiplier for that shop's currency really is free there.

### 5.2 Editing a price

The row becomes an inline editor:

```
[i] Small Potion   [0] Rune [0] Luna [75] Cron    [Save] [Cancel]
    Sells back for 18 cron. Sold by 12 vendors: this changes all of them.
```

- PvP shops show one points field and no sell-back line, since sell-back is always paid from `fPrice`.
- The sell-back line updates as you type.
- The vendor count warning appears only when more than one vendor sells the item.
- Save is disabled when the price is unchanged.
- If `chargedPrice` can't reach the amount, the editor shows `Will charge 1,234,567,936 cron` before saving.
- Items with base 0 have no edit button, only `Price can't be set: level 0 item`.
- A failed save shows its error in the row and keeps the typed values.

### 5.3 Removing an item

The trash button asks for confirmation inline, naming the item and the vendor, like the Logins page. It only affects this vendor.

### 5.4 Adding an item

`+ Add item` opens a search box above the table, debounced.

- Results show icon, name, ID, level and the current price in this shop's currency.
- Clicking a result adds it immediately, because removing it is one click. If its price in this shop is 0, the confirmation says it is free until a price is set.
- Items this vendor already sells are greyed out with `Already sold`.
- Items not in the client are greyed out with `Not in client`.
- The API enforces these checks too.

### 5.5 After a change

The stock and vendor queries refresh. A note confirms the change, for example `Small Potion now costs 75 cron at 12 vendors. Restart TMapSvr to apply.`

Load failures use `FormMessage` (`Could not load vendors.`).

## 6. Testing

| Layer | Where | Covers |
|---|---|---|
| Price functions | `packages/shared/src/gm.test.ts` | Real rows (item 8001: base 1, multiplier 50, price 50), a case needing a float nudge (base 475, 499,650), a price no float can reach (base 53750, 16,000,000 charges 15,999,999), sell-back, base 0, money split and join |
| Import parsing | `apps/api/test/game-icons-import.test.ts` | Small built buffers for each chart format, list and sprite lookup, DXT decoding, strict failure on leftover bytes, best-effort NPC files |
| Service rules | `apps/api/test/` with fakes | Every rejection in section 4.3, the 255 limit including `DCC_ALLCOUNTRY`, audit text |
| HTTP | `apps/api/test/gm-vendors.http.test.ts` | Non-GMs get 403, validation, status codes |
| Real database | `apps/api/test/db/vendors.db.test.ts` | Queries against `_TEST`, rolled back: vendor filter, base lookup with and without attributes, stock join, sold-by count, add, remove, price update. `table-names.test.ts` covers the new names. |
| Web | `apps/web/src/routes/gm-vendors.test.tsx` | Search, selecting a vendor, price edit and preview, confirm on remove, greyed-out add results, `_TEST` banner |

**Checked by hand before calling it done:**
1. Run the real import against the client and look at the icons.
2. Run the page against `_TEST`, making each kind of edit.

**Checked by the user, because it needs the live database, a `TMapSvr` restart and a client:** a short checklist that changes one price and adds one item, then confirms the shop price, the purchase charge, sell-back and the opened shop in game.

## 7. Documentation

The README's GM tools section gains the vendor tool, `import:icons`, the restart requirement and the stale sell-price tooltip. `.env.example`'s comment on `GAME_TCD_DIR` mentions `import:icons`.
