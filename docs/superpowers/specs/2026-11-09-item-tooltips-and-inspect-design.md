# Item tooltips and character inspect

Date: 2026-11-09

## Goal

1. Hovering an equipped item on the portal shows the same tooltip the game client shows: the same lines, numbers and colours.
2. Any logged-in player can open another character and see what it has equipped, like Inspect in World of Warcraft.

## Decisions

| Question | Decision |
|---|---|
| Other players' visibility | Equipped gear only. Bags, warehouse and gold stay private. |
| Ways to reach a character | Clickable names on Hall of Fame and Leaderboard, plus a name search. |
| Where tooltips are built | In the API, from a generated snapshot of the client charts. The page only draws finished lines. |
| Tooltip look | Game style: dark glass panel, small game-like font, in-game colours. |
| Gear layout | Character window: icons in fixed slots, empty slots visible. Used on both the inspect page and your own character page. |
| Scope of tooltips this round | Your own character page and the inspect page. GM vendor tables and other catalogue views are unchanged. |

The game, its servers and its database are only read. No game changes, so no entries in the changes ledger.

## Chart import

A new command, `npm run import:tooltips -w apps/api`, follows the pattern of `import:icons`. It reads `GAME_TCD_DIR` and writes `apps/api/src/gm/game-tooltips.generated.ts`, which is committed. When a game patch changes the charts, tooltips stay on the old data until the import is rerun. The README records this.

All these charts use MFC archive format: a `WORD` count, then records. `CString` is a length byte (`0xFF` then a `WORD` for long strings), then Latin-1 bytes.

| Chart | Record | Used for |
|---|---|---|
| `TItem.tcd` | Existing parser in `Extractor/src/lib/titem.js` (port the field list) | Name, type, kind, attr ID, level, durability max, refine max, price, info ID, slot, can-grade |
| `TInfo.tcd` | `DWORD id`, `BYTE count`, `count` CStrings | Line templates |
| `TItemAttr.tcd` | `WORD id`, `BYTE grade`, `WORD minAP, maxAP, DP, minMAP, maxMAP, MDP`, `BYTE block, speedInc` (17 bytes) | Stats by attr ID |
| `TItemMagic.tcd` | `CString name`, `WORD id`, `BYTE optionKind`, `FLOAT util`, `BYTE sfx` | Option names and weights. `optionKind` 0 means a secondary option. |
| `TItemGrade.tcd` | `BYTE grade`, `BYTE step` | Attr ID step for each grade |
| `TFormula.tcd` | `BYTE id`, `DWORD init`, `FLOAT rateX, rateY` | Power level formula |
| `TLevel.tcd` | `BYTE level`, `DWORD cost, regCost, searchCost` | Sell price by attr level |
| `TString.tcd` | `WORD id`, `CString text` | Option title, attr level names, money, time and effect names |

To keep the file small, the import keeps only templates referenced by an item and stores each unique template once. Only items with an equipment slot are kept, and the `TSTR_*` numeric IDs are worked out from their position in `Lib/Own/TChart/TChart/TChartType.h` (`TSTR_NONE` is 0).

## Data read per item

`StatsRepository.gear()` adds these `TITEMTABLE` columns to the existing equipped-item query:

- `bLevel` (grade), `bGem`, `bGLevel`, `bCount`, `dwDuraMax`, `dwDuraCur`, `bRefineCur`, `dEndTime`, `bGradeEffect`, `wMoggItemID`
- `bMagic1`–`6` and `wValue1`–`6` (options)
- `dwTime1`–`6`, which the server loads into its extended values in this order: level reduction, wrap, colour, guild, companion, custom cloak texture (`DBAccess.h`, `IEV_*` in `NetCode.h`)

`dEndTime` of `1900-01-01` means no expiry.

`TITEMCHART.fRevision` and `fMRevision` come with each item, and `TITEMMAGICCHART.bRvType` and `wMaxValue` are loaded once per snapshot, because the server rescales a stored option value before sending it to the client (`CTItem::GetMagicValue`): `WORD(revision * stored * maxValue) / 100`, at least 1. Revision is 1 when `bRvType` is 0, otherwise the item's revision at `bRvType - 1`.

## Building a tooltip

A pure module, `apps/api/src/stats/item-tooltip.ts`, ports these client functions. It takes an item row and the generated charts and returns a tooltip. It reads no database and no clock of its own: the current time is passed in.

```ts
type TooltipLine = { text: string; color: string };
type ItemTooltip = {
  title: TooltipLine;
  /** The blue number on the tooltip icon, null when hidden. */
  competence: number | null;
  /** Icon border: from the game's skin rules. */
  quality: 'normal' | 'magic' | 'rare' | 'grade' | 'wrap';
  lines: TooltipLine[];
};
```

`GearItem` gains `tooltip: ItemTooltip`. The rest of its fields stay.

Rules, each from the named client source:

**Tooltip type** (`CTDetailInfoManager::NewItemInst`): costume and cloak items and items with grade, options or gems use the full option tooltip. Plain items use the instance tooltip. An item with `bGLevel` set that isn't a gamble item is sealed, and shows only its title.

Options are applied in ascending ID order, as the client's `std::map` holds them.

**Attr ID** (`CTClientItem::CalcAttrID`): item attr ID, plus the `TItemGrade` step for its grade, plus gems. Then options are applied to a copy of the stats: physical and long attack options add to min and max AP, magic attack adds the value plus 20 to min and max MAP, and physical and magic defence add to DP and MDP. If any of those applied and the power level exceeds the attr's grade, the attr ID moves up by the difference. That only changes the competence level: the shown stats keep the values from before the move. Power level is the weapon or shield formula in `GetWeaponPowerLevel` and `GetShieldPowerLevel`, using `TFormula`.

**Quality** (`GetQuality`): these are flags that can combine. More than 2 options sets rare, 1–2 sets magic, grade over 0 sets grade, gems set gem, an appearance item sets mogg, and none of these is normal. The template title is chosen in this order: grade, magic, rare, normal, then gem or mogg (both use the grade line). The icon border (`CheckUsingSkin`) is chosen in this order: wrap, grade, rare, magic. The title colour is the grade colour when graded, otherwise the rare, magic or normal colour.

**Sell price** (`/SellPrice`): port `CTClientItem::CalcPrice` using `TLevel` and divide by 4, shown through `MakeMoneyStr`.

**Lines** (`CTItemDetInfo`, `CTItemInstDetInfo`, `CTOptionItemDetInfo`):

- The first template line matching the quality becomes the title. `/ItemNormal`, `/ItemGrade`, `/ItemMagic`, `/ItemRare` select it, and the rest of those lines are dropped. `/ItemSet` and `/ItemUnique` lines are dropped as they are in the client today.
- A line with no `/` is kept unchanged. A line with a `/` is kept only if at least one recognised token on it has a value. Tokens with no value stay in the line as written, and a line whose only tokens are unrecognised (such as `/UseTime`) is dropped. These match `_ConvertAndAddLine`.
- On cloaks and on items that can take gems, the competence line shows the attr grade minus gems, then ` +N` for the gems, in yellow. The needs-level line subtracts the level reduction and turns blue when reduced. A stat line raised by a main option uses the magic colour (`_IsMagicLine`).
- Tokens: `/ItemMinAP`, `/ItemMaxAP`, `/ItemAPSec`, `/ItemDP`, `/ItemMinMAP`, `/ItemMaxMAP`, `/ItemMAPSec`, `/ItemMDP`, `/ItemBlock`, `/GradeLevel /GemStoneLevel`, `/DuraMin`, `/DuraMax`, `/RefineMin`, `/RefineMax`, `/SellPrice`, `/EndTime`, `/NeedsLevel`.
- From the line holding `/OptionBonus` onward, option lines are filled from the item's secondary options, and dropped when it has none. `/OptionLevel` is the summed option weight divided by 10 and capped at 8, naming F, E, D, C, B, A, S, SS or SSS.
- The title gains the grade number, the grade effect name, the wrap footer, the custom cloak line, the appearance item lines and the costume refines line, under the client's conditions.
- Only secondary options with a value above 0 appear as option lines. When the item is graded the title template is filled in; otherwise the title is the plain item name, with any effect suffix.
- Line wrapping is left to CSS at a fixed tooltip width.

**Colours**: default text `#F9E9CA`. Grade title `rgb(240, 240 - grade*10, 240 - grade*10)`. Rare `#FFB12A`. Magic `#44A9FF`. Normal `#DBD6CA`. Gem competence line yellow `#FFFF00`. Wrap footer `#FF6464`. Appearance `#FF66FF`. Costume refines `#00FF33`. Custom cloak `#0099FF`. Competence badge `#80CCFD`.

**Missing data**: an item not in the client charts returns its database name and one "Unknown item" line. An item with no attr entry loses its stat lines and keeps everything else. The client charts are used in preference to `TITEMCHART`, because they are what players see.

## Inspect API

- `GET /characters/:id/inspect` returns:

```ts
type CharacterInspect = {
  id: number; name: string; level: number;
  className: string; race: string; country: string;
  gear: GearItem[];
};
```

It's a separate type from `CharacterProfile`, and is built field by field so private fields can't leak.

- A character can be inspected when it is in `contenders(snapshot)`: not deleted, not banned, and not on a hidden GM account. The requester's own characters can always be inspected. Everything else gets the same `404 Character not found`.
- `GET /characters/search?q=` matches any part of a name, case-insensitively. `q` is 2–16 characters, trimmed. It returns up to 20 `{ id, name, level, className }` from the inspectable characters, sorted with exact matches first, then by name. It reads only the existing cached snapshot.
- `HallEntry` gains `characterId: number`. The badge category ranks accounts, but each row already represents that account's top character, so its link goes there.

Both routes use the existing `SessionGuard`, and the search route also uses `ThrottlerGuard`.

## Web

- `components/items/ItemTooltip.tsx`: the Style A panel.
- `components/items/ItemSlot.tsx`: an icon with quality border and tooltip. It opens on hover or keyboard focus, toggles on tap, and closes on Esc or tapping elsewhere. It sits next to the slot and flips at the screen edge.
- `components/items/CharacterGear.tsx`: the character window. Left column: head, neck, body, hands, legs, feet. Right column: back, both earrings, both rings, face. Below: the three weapon slots (0–2), then the four costume slots (15–18). Empty slots stay visible. Item names are available to screen readers.
- `routes/_authed/inspect.$id.tsx`: header plus `CharacterGear`. A 404 shows "Character not found" with a link back to the Leaderboard.
- `routes/_authed/characters_.$id.tsx`: `CharacterGear` replaces the current gear list. Everything else stays.
- `RankingCard` and the Leaderboard table: names link to `/inspect/$id`, or to `/characters/$id` when the entry is yours.
- Leaderboard: a search box, debounced, listing matches that link to the inspect page.

## Testing

- `item-tooltip` unit tests with real chart values: normal, graded, gemmed cloak, magic, rare, sealed, expired, timed, wrapped, appearance, costume, unknown item, no attr entry.
- Importer tests: each chart parser against a small fixture, and the template reduction.
- `stats.http` tests: inspect visibility (banned, hidden GM, deleted, own banned, unknown ID all as specified), no private fields in the response, search matching, order, limit and length limits.
- DB test on `TGAME_GSP_TEST` for the extended gear query.
- Web tests: tooltip rendering and open/close, character window slots, links, search, the not-found page.
- Tests and manual runs never use the live databases or the dev servers on 3000 and 5173: `DB_GLOBAL_NAME=TGLOBAL_GSP_TEST DB_GAME_NAME=TGAME_GSP_TEST`, and a separate copy on port 3100.
- Final acceptance: the owner compares 3–4 real items against the running client.

## Out of scope

Bags and warehouse views, companions, titles and rankings on inspect, an opt-out for players, extracting the game's real frame art, tooltips on catalogue views, and comparing an item to your own.
