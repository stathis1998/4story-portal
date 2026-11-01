# GM Vendors Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GM page to search vendors, view their stock with game icons, change item prices, and add or remove stock, plus a script that extracts those icons from the game client.

**Architecture:** `npm run import:icons -w apps/api` reads the client once and commits PNGs under `apps/web/public/game-icons/` and an ID lookup in `apps/api/src/gm/game-icons.generated.ts`. A new controller, service and repository in `apps/api/src/gm/` edit `TNPCITEMCHART` and `TITEMCHART`, with price arithmetic in `packages/shared` so API and browser agree. `/gm/vendors` is a two-pane React page.

**Tech Stack:** NestJS 12, mssql, Zod 4, React 19, TanStack Router and Query, Tailwind, Vitest, pngjs (new, dev only).

**Spec:** `docs/superpowers/specs/2026-11-01-gm-vendors-design.md`. Read it first; section 2 explains why the rules below exist.

## Global Constraints

- Tests and manual runs write only to the databases named in `.env`, which must stay on the `_TEST` copies. Never write to `TGAME_GSP` or `TGLOBAL_GSP`.
- `npm test` never touches a database. Real-database tests live in `apps/api/test/db/` and run in a rolled-back transaction.
- Vendors are exactly `bType IN (2, 21)`. `2` pays money (`fPrice`, `dwMoney`), `21` pays PvP points (`fPvPrice`, `dwPvPMoney`).
- Vendor and item names come from the database. A name of `_` counts as empty.
- Commit messages follow the repo style (`feat(api): …`, `feat(web): …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work happens on the existing `feat/gm-vendors` branch.
- API code style: 2 spaces, semicolons, `.js` import suffixes. Web code style: no semicolons, single quotes, no import suffixes.
- The apps import `@4story-portal/shared` from its `dist`. After changing it, run `npm run build -w packages/shared` before running API or web tests directly.
- The game source and `Extractor` are at `C:\Users\stath\Documents\4Story\4s\4Story_5.0_Source - kopie`. Read them; never modify them. The client is the parent of `GAME_TCD_DIR` in `.env`.

## Review Focus

1. **Item search containing `_`, `%` or `[`:** these are literal characters, not SQL wildcards. Test in Task 5.
2. **Route IDs that are non-numeric or outside 1 to 32767:** a 400, never a 500 from a parameter overflow. Test in Task 7.
3. **A vendor with an empty name, or empty name and title:** shows its title, or `NPC 20002`, never a blank row. Test in Task 8.
4. **A stale or garbage `?vendor=` in the URL:** the page shows `That NPC is not a vendor.` or no selection, and doesn't crash. Test in Task 8.
5. **Stocking an item whose price is 0 for that shop's currency:** the row shows `Free` and the confirmation says so. A PvP shop giving away an item with `fPvPrice = 0` must be visible to the GM. Tests in Tasks 9 and 10.

---

### Task 1: Shared price functions, schemas and types

**Files:**
- Modify: `packages/shared/src/gm.ts`, `packages/shared/src/api-types.ts`
- Test: `packages/shared/src/gm.test.ts`

**Interfaces:**
- Produces, in `gm.ts`:
  - `MAX_PRICE = 4_294_967_295`
  - `chargedPrice(base: number, multiplier: number): number`
  - `multiplierForPrice(base: number, amount: number): number`
  - `sellBackPrice(price: number): number`
  - `splitMoney(price: number): { rune: number; luna: number; cron: number }`
  - `joinMoney(parts: { rune: number; luna: number; cron: number }): number`
  - `gmIdSchema` (a `z.coerce.number()` integer, 1 to 32767, for route params)
  - `addVendorItemSchema` (`{ itemId }`, integer 1 to 32767), type `AddVendorItem`
  - `itemPriceSchema` (`{ currency: 'money' | 'pvp', amount }`, integer 0 to `MAX_PRICE`), type `ItemPriceInput`
  - `itemSearchQuerySchema` (trimmed string, 1 to 50 characters)
- Produces, in `api-types.ts`:

```ts
export type VendorShop = 'money' | 'pvp';
/** name and title are '' when the database holds '_'. */
export type GmVendor = {
  id: number; name: string; title: string; shop: VendorShop; country: string;
  mapId: number; mapName: string | null; itemCount: number; faceIcon: number | null;
};
export type GmVendorList = { database: string; vendors: GmVendor[] };
/** name is null for a stock row whose item is not in TITEMCHART. base and multiplier are for the vendor's currency. */
export type GmVendorItem = {
  itemId: number; name: string | null; level: number; icon: number | null;
  base: number; multiplier: number; price: number; soldBy: number;
};
export type GmItemSearchResult = {
  itemId: number; name: string; level: number; icon: number | null;
  price: number; pvpPrice: number; inClient: boolean;
};
export type GmItemPriceResult = { itemId: number; name: string; price: number; multiplier: number; soldBy: number };
```

- [ ] **Step 1: Write the failing tests** in `gm.test.ts`

```ts
describe('chargedPrice', () => {
  it.each([[1, 50, 50], [475, 5, 2375], [53750, 5, 268750], [0, 5, 0], [475, 0, 0]])(
    'base %d x %d = %d', (base, multiplier, price) => expect(chargedPrice(base, multiplier)).toBe(price));
});

describe('multiplierForPrice', () => {
  it('returns 0 for a free item', () => expect(multiplierForPrice(475, 0)).toBe(0));
  it('finds the exact multiplier', () => expect(chargedPrice(475, multiplierForPrice(475, 2375))).toBe(2375));
  it('moves to a neighboring float when plain division misses', () => {
    expect(chargedPrice(475, Math.fround(499650 / 475))).toBe(499651);
    expect(chargedPrice(475, multiplierForPrice(475, 499650))).toBe(499650);
  });
  it('gets as close as a float can when no multiplier is exact', () =>
    expect(chargedPrice(53750, multiplierForPrice(53750, 16_000_000))).toBe(15_999_999));
  it('returns a 32-bit float', () => {
    const multiplier = multiplierForPrice(3960, 5);
    expect(Math.fround(multiplier)).toBe(multiplier);
  });
});

describe('sell back and money', () => {
  it('pays a quarter, rounded down', () => expect(sellBackPrice(75)).toBe(18));
  it('splits', () => expect(splitMoney(268_750)).toEqual({ rune: 0, luna: 268, cron: 750 }));
  it('joins, carrying oversized parts', () => expect(joinMoney({ rune: 1, luna: 1500, cron: 2 })).toBe(2_500_002));
});

describe('vendor schemas', () => {
  it.each(['abc', '0', '-1', '32768', '1.5'])('gmIdSchema rejects %j', (id) =>
    expect(gmIdSchema.safeParse(id).success).toBe(false));
  it('gmIdSchema coerces a numeric string', () => expect(gmIdSchema.parse('20002')).toBe(20002));
  it.each([-1, 1.5, 4_294_967_296])('itemPriceSchema rejects %d', (amount) =>
    expect(itemPriceSchema.safeParse({ currency: 'money', amount }).success).toBe(false));
  it('itemPriceSchema accepts 0', () =>
    expect(itemPriceSchema.safeParse({ currency: 'pvp', amount: 0 }).success).toBe(true));
  it('itemSearchQuerySchema rejects blank', () => expect(itemSearchQuerySchema.safeParse('   ').success).toBe(false));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w packages/shared`
Expected: FAIL, functions not exported.

- [ ] **Step 3: Implement.** Copy the server's arithmetic (spec 2.3):

```ts
export const chargedPrice = (base: number, multiplier: number) =>
  Math.trunc(Math.fround(Math.fround(base) * Math.fround(multiplier)) + 0.99);
```

`multiplierForPrice`: start at `Math.fround(amount / base)` and step through neighboring floats using a shared `Float32Array`/`Uint32Array`, up to 64 steps each way, keeping the closest and stopping at an exact hit. Only callers with `base > 0` reach it, since the service rejects base 0 first.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w packages/shared; npm run build -w packages/shared`
Expected: tests PASS and the build succeeds, so later tasks see the new exports.

- [ ] **Step 5: Commit** as `feat(shared): vendor price arithmetic, schemas and types`.

---

### Task 2: Chart parsing for the icon lookup

**Files:**
- Modify: `apps/api/src/gm/game-places-import.ts` (export `ArchiveReader`)
- Create: `apps/api/src/gm/game-icons-import.ts`
- Test: `apps/api/test/game-icons-import.test.ts`

**Interfaces:**
- Consumes: `ArchiveReader` (`u8`, `u16`, `u32`, `f32`, `skip`, `string`, `assertFinished`).
- Produces:

```ts
export const ITEM_ICON_LIST = 0x2169;
export const FACE_ICON_LIST = 26269;
export type ImageLists = Map<number, (number | null)[]>;
export type IconLookup = { itemIcons: Map<number, number | null>; npcFaces: Map<number, number> };

parseItems(file: Buffer): { itemId: number; visualId: number }[];         // TItem.tcd, strict
parseItemVisuals(file: Buffer): Map<number, number>;                      // TItemVisual.tcd: visual id -> icon index, strict
parseNpcTemplates(file: Buffer): Map<number, number>;                     // TNPCTemp.tcd: template id -> face index, strict
parseNpcFile(file: Buffer): { npcs: { id: number; templateId: number }[]; complete: boolean };
isNpcFileName(name: string): boolean;
parseImageLists(file: Buffer, wanted: number[]): ImageLists;              // TClientCmd.tif
buildIconLookup(input: {
  items: { itemId: number; visualId: number }[]; visuals: Map<number, number>;
  templates: Map<number, number>; npcs: { id: number; templateId: number }[]; lists: ImageLists;
}): IconLookup;
usedSprites(lookup: IconLookup): Set<number>;
renderIconsFile(lookup: IconLookup, available: ReadonlySet<number>): string;
```

Formats:
- `TItem.tcd`: `u16` count, then the fields in `Extractor/src/lib/titem.js` `ITEM_FIELDS`. `visualId` is `Visual0`.
- `TItemVisual.tcd`: `u16` count, then `ITEM_VISUAL_FIELDS` in `Extractor/src/lib/titemvisual.js`. Use `Icon`.
- `TNPCTemp.tcd`: `u16` count, then `u16 id, u32 obj, 19×u16 items, u8 action, u8 rnd0, u8 rnd1, u32 snd, u16 face, u8 boxAnim`.
- `TNPC<8 hex>.tcd` and `TNPCGlobal.tcd`: `u16` count, then `u32 id, u16 templateId, string name, string title, u8 type, 11×u8, u32 house, u32 menu, u32 exec, u32 quest, u16 item, u32 maxHp, 10×f32, u8 camp`.
- `TClientCmd.tif`: not `ArchiveReader` strings. Port `parseFrame` from `Extractor/src/lib/tcml.js`, including its `int32`-length strings. Image lists have type `0x0a`. When an ID appears several times, keep the list with the most children, as `buildImageListIndexMap` does. `0xFFFFFFFF` means `null`.

- [ ] **Step 1: Write the failing tests.** Move the `ArchiveWriter` test helper from `game-places-import.test.ts` into a new `apps/api/test/archive-writer.ts` and import it from both. Tests:

```ts
it('parseItems reads id and first visual, and rejects leftover bytes');
it('parseItemVisuals maps visual id to icon index, and rejects leftover bytes');
it('parseNpcTemplates maps template id to face index, and rejects leftover bytes');

describe('parseNpcFile', () => {
  it('reads every record of a good file', () =>
    expect(parseNpcFile(npcFile([[20002, 695]]))).toEqual({ npcs: [{ id: 20002, templateId: 695 }], complete: true }));
  it('keeps records before a truncated one and reports it', () => {
    const { npcs, complete } = parseNpcFile(truncatedSecondRecord);
    expect(npcs).toEqual([{ id: 1, templateId: 2 }]);
    expect(complete).toBe(false);
  });
  it('treats an empty file as incomplete', () =>
    expect(parseNpcFile(Buffer.alloc(0))).toEqual({ npcs: [], complete: false }));
});

it.each([['TNPC00000000.tcd', true], ['TNPC02bf0000.tcd', true], ['TNPCGlobal.tcd', true],
         ['TNPCTemp.tcd', false], ['TNPCPOS.tcd', false], ['TNPC02bf00000.tcd', false], ['TNPCINFO.tcd', false]])(
  'isNpcFileName(%s) is %s', (name, ok) => expect(isNpcFileName(name)).toBe(ok));

it('parseImageLists keeps the largest list per id, walks children, and maps 0xFFFFFFFF to null');

describe('buildIconLookup', () => {
  const lists = new Map([[ITEM_ICON_LIST, [null, 500]], [FACE_ICON_LIST, [null, 600]]]);
  it('resolves item to sprite, with null when the visual or index is missing', () => {
    const { itemIcons } = buildIconLookup({
      items: [{ itemId: 1, visualId: 10 }, { itemId: 2, visualId: 99 }, { itemId: 3, visualId: 11 }],
      visuals: new Map([[10, 1], [11, 0]]), templates: new Map(), npcs: [], lists,
    });
    expect([...itemIcons]).toEqual([[1, 500], [2, null], [3, null]]);
  });
  it('leaves out NPCs with no template or face 0', () => {
    const { npcFaces } = buildIconLookup({
      items: [], visuals: new Map(), templates: new Map([[7, 1], [8, 0]]),
      npcs: [{ id: 1, templateId: 7 }, { id: 2, templateId: 8 }, { id: 3, templateId: 9 }], lists,
    });
    expect([...npcFaces]).toEqual([[1, 600]]);
  });
});

it('renderIconsFile keeps every item key, and nulls sprites that have no pixels');
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/game-icons-import.test.ts` in `apps/api`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement.** Generated file format, one entry per line and sorted by ID:

```ts
// Generated by src/gm/import-game-icons.ts. Do not edit: rerun the import (see the README).
export const itemIcons: Readonly<Record<number, number | null>> = {
  3: 6361,
};
export const npcFaces: Readonly<Record<number, number>> = {
  20002: 6480,
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/game-icons-import.test.ts test/game-places-import.test.ts` in `apps/api`
Expected: PASS.

- [ ] **Step 5: Commit** as `feat(api): parse item and NPC icon lookups from the client charts`.

---

### Task 3: Sprite decoding

**Files:**
- Create: `apps/api/src/gm/game-sprites.ts`
- Modify: `apps/api/package.json` (dev dependencies `pngjs`, `@types/pngjs`)
- Test: `apps/api/test/game-sprites.test.ts`

**Interfaces:**
- Produces:

```ts
decodeDds(file: Buffer): { width: number; height: number; rgba: Buffer };
composeSprite(image: SpriteImage, textures: ReadonlyMap<number, Texture>): { width: number; height: number; rgba: Buffer };
extractSprites(input: {
  imageIndex: Buffer;                 // Index/TClientI.IDX
  bufferList: Buffer;                 // Index/TClientList.LST
  readData: (relativePath: string) => Buffer;  // reads under Data/, paths use backslashes
  wanted: ReadonlySet<number>;
}): Map<number, Buffer>;              // sprite id -> PNG. A wanted sprite with no image data is absent.
```

Port, keeping behavior identical: `Extractor/src/lib/dds.js` (DXT1, DXT3, DXT5, BGRA32), `container.js`, `index-files.js`, and from `icon-extractor.js`: `extractSourceTexture`, `parseImageData`, `parseImageSet`, `renderPart`, `sampleNearest`, `blendPixel`, `composeIconPng`. Source textures may be DDS or PNG.

To keep memory reasonable, read `.TIM` blocks directly at each wanted sprite's `pos` from the index. Then scan the `.TIS` files and decode only the textures those sprites use. A texture block's ID is at its start, so skipping is cheap after inflating.

- [ ] **Step 1: Write the failing tests**

```ts
describe('decodeDds', () => {
  it('decodes a DXT1 block: color0 red, all indices 0', () => {
    const { width, height, rgba } = decodeDds(dds('DXT1', 4, 4, dxt1Block(0xf800, 0x001f, 0)));
    expect([width, height]).toEqual([4, 4]);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });
  it('applies DXT3 explicit alpha', /* alpha nibble 0x8 reads as 0x88 */);
  it('applies DXT5 interpolated alpha', /* alpha0 = 200, index 0 reads as 200 */);
  it('decodes uncompressed BGRA using the channel masks');
  it('rejects a non-DDS buffer', () => expect(() => decodeDds(Buffer.from('nope'))).toThrow('Unsupported DDS'));
  it('rejects an unsupported format', () => expect(() => decodeDds(dds('DXT2', 4, 4, Buffer.alloc(16)))).toThrow());
});

describe('composeSprite', () => {
  it('copies a full-quad texture onto the canvas');
  it('places a part at its vertex position and alpha-blends a later part over it');
  it('skips a part whose texture is missing, leaving it transparent');
});

describe('extractSprites', () => {
  it('builds a PNG for a wanted sprite from built IDX, LST, TIM and TIS buffers', () => {
    const sprites = extractSprites(fixture({ wanted: new Set([7000]) }));
    expect(PNG.sync.read(sprites.get(7000)!).width).toBe(32);
  });
  it('ignores unwanted sprites', () => expect(extractSprites(fixture({ wanted: new Set() })).size).toBe(0));
  it('omits a wanted sprite with no image data', /* imageDataSize 0 */);
  it('omits a wanted sprite missing from the index');
});
```

Build fixtures with `zlib.deflateSync` in the test file, following the layouts in the Extractor files above.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/game-sprites.test.ts` in `apps/api`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement** the port in TypeScript.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/game-sprites.test.ts` in `apps/api`
Expected: PASS.

- [ ] **Step 5: Commit** as `feat(api): decode client sprites to PNG`.

---

### Task 4: Import script and generated output

**Files:**
- Create: `apps/api/src/gm/import-game-icons.ts`
- Generate: `apps/api/src/gm/game-icons.generated.ts`, `apps/web/public/game-icons/*.png`
- Modify: `apps/api/package.json`, `.env.example`

**Interfaces:**
- Consumes: Task 2's `parse*`, `buildIconLookup`, `usedSprites`, `renderIconsFile`. Task 3's `extractSprites`.
- Produces: `itemIcons` and `npcFaces` exports from `game-icons.generated.ts`, and icon URLs `/game-icons/<spriteId>.png`.

- [ ] **Step 1: Write the script**, in the shape of `import-game-places.ts` (same `dotenv` line, `main().catch`). Add `"import:icons": "nest build && node dist/gm/import-game-icons.js"` to `apps/api/package.json`. Order of work:
  1. Require `GAME_TCD_DIR`, otherwise fail with `Set GAME_TCD_DIR in .env to the Tcd folder of the game client`. The client root is its parent.
  2. Parse everything and extract all PNGs into memory. Read NPC files in sorted name order; print one warning line per `complete: false` file.
  3. Only then write: the generated file to `src/gm/game-icons.generated.ts`, PNGs to `../web/public/game-icons/`, and delete `.png` files in that folder not in this run.
  4. Print: items, items with no icon, NPC faces, PNGs written, PNGs removed, NPC files skipped.

  Update the `.env.example` comment to `Only for import:places and import:icons -w apps/api: the Tcd folder of the game client players use.`

- [ ] **Step 2: Run it against the real client**

Run: `npm run import:icons -w apps/api`
Expected: about 7,775 items with about 617 having no icon, and 9 NPC file warnings (the files listed in spec 2.7). No error. `apps/web/public/game-icons/` holds about 2,150 PNGs.

- [ ] **Step 3: Check the pixels match the Extractor**

From the scratchpad, write a throwaway Node script. For each PNG in `apps/web/public/game-icons/` with a same-named file in `Extractor/output/araz-icons-test/icons/`, compare decoded RGBA. Expected: 0 differences. Then look at these yourself with the Read tool: `<itemIcons[8001]>.png` (a potion) and `<npcFaces[20142]>.png` (green-haired elf).

- [ ] **Step 4: Run the checks**

Run: `npm run lint -w apps/api; npm test -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit** script, generated file and PNGs as `feat(api): import item icons and NPC portraits from the game client`.

---

### Task 5: Vendors repository

**Files:**
- Modify: `apps/api/src/db/db.service.ts`, `apps/api/test/table-names.test.ts`
- Create: `apps/api/src/gm/vendors.repository.ts`
- Test: `apps/api/test/db/vendors.db.test.ts`

**Interfaces:**
- Produces, in `tableNames` (game DB): `npcs` (`TNPCCHART`), `npcItems` (`TNPCITEMCHART`), `items` (`TITEMCHART`), `itemAttrs` (`TITEMATTRCHART`), `levels` (`TLEVELCHART`).
- Produces, in `vendors.repository.ts`:

```ts
export const VENDOR_TYPES = { money: 2, pvp: 21 } as const;
export type VendorRow = { id: number; name: string; title: string; type: number; country: number;
  condition: number; mapId: number; itemCount: number };
export type ItemRow = { itemId: number; name: string; level: number; stack: number; classMask: number;
  itemCountry: number; money: number; pvpMoney: number; fPrice: number; fPvPrice: number; soldBy: number };
/** A row whose item is not in TITEMCHART has name null and zeros for the rest. */
export type StockRow = Omit<ItemRow, 'name'> & { name: string | null };
export type PriceColumn = 'fPrice' | 'fPvPrice';

export interface VendorsRepository {
  listVendors(): Promise<VendorRow[]>;
  findVendor(id: number): Promise<VendorRow | null>;   // vendors only
  listStock(vendorId: number): Promise<StockRow[]>;    // ordered by item id, the order the game shows
  findItem(itemId: number): Promise<ItemRow | null>;
  searchItems(q: string): Promise<ItemRow[]>;          // up to 50, exact id first, then by name
  addStock(vendorId: number, itemId: number): Promise<boolean>;     // false when already sold
  removeStock(vendorId: number, itemId: number): Promise<boolean>;  // false when not sold
  setPrice(itemId: number, column: PriceColumn, multiplier: number): Promise<void>;
}
export const VENDORS_REPOSITORY = Symbol('VENDORS_REPOSITORY');
export class SqlVendorsRepository implements VendorsRepository { /* withTransaction, like SqlGmRepository */ }
```

SQL rules:
- `money` and `pvpMoney` come from `TLEVELCHART` at `CASE WHEN t.wAttrID <> 0 THEN ISNULL(a.bGrade, 0) ELSE t.bLevel END`, with `ISNULL(…, 0)` for a missing level row. `level` is that same expression. `a` is `LEFT JOIN itemAttrs a ON a.wID = t.wAttrID`.
- `soldBy` counts rows in `npcItems` joined to `npcs` with `bType IN (2, 21)` only.
- Names: `name = CASE WHEN szName = '_' THEN '' ELSE szName END`, and likewise `title` from `NC_szName2`.
- Bind IDs as `sql.Int` so out-of-range values can't overflow a `smallint` parameter.
- `addStock` catches SQL error `number === 2627` and returns false.
- `searchItems`: `szNAME LIKE @q ESCAPE '\'`, escaping `\`, `%`, `_` and `[` in the input; plus `OR t.wItemID = @id` when `q` is digits only.

- [ ] **Step 1: Write the failing tests.** Add the five tables to `table-names.test.ts`. In `vendors.db.test.ts`, using `withTransaction` and `inRolledBackTransaction` as in `gm.db.test.ts`:

```ts
it('lists only vendor types', async () => {
  const vendors = await repo.listVendors();
  expect(vendors.map((v) => v.id)).toContain(20002);   // type 2
  expect(vendors.map((v) => v.id)).toContain(20757);   // type 21
  expect(vendors.map((v) => v.id)).not.toContain(22229); // type 11, has TNPCITEMCHART rows
  expect(vendors.every((v) => v.type === 2 || v.type === 21)).toBe(true);
});
it('includes a vendor with no stock', /* 25300, itemCount 0 */);
it('blanks a name of underscore', /* 20002 has NC_szName2 '_', so title is '' */);
it('findVendor returns null for a non-vendor NPC', /* 22229 */);
it('lists stock with the base for the item level', /* vendor 26012, item 4: level 5, money 475, fPrice 5, stack 1 */);
it('uses the attribute grade as the level', /* item 551: level 34, money equals TLEVELCHART at 34 */);
it('counts only vendors in soldBy');
it('adds and removes stock', /* add true, add again false, remove true, remove again false, using an unsold item */);
it('updates only the chosen price column', /* setPrice(8001, 'fPrice', 75); fPrice 75, fPvPrice unchanged */);
it('finds an item by exact id first', /* searchItems('8001')[0].itemId is 8001 */);
it('treats wildcards in a search as literal text', async () => {
  expect(await repo.searchItems('%')).toEqual(await literalMatches('%'));
  expect((await repo.searchItems('Sm_ll Vitality')).length).toBe(0);
  expect((await repo.searchItems('[a-z]')).length).toBe(0);
});
it('returns at most 50 results', /* searchItems('a') */);
```

`literalMatches` runs a `CHARINDEX` query for the same text. Use an item not in vendor 20002's stock for the add test.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:db -w apps/api -- test/db/vendors.db.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement** `SqlVendorsRepository` and the table names.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:db -w apps/api; npx vitest run test/table-names.test.ts` (the second in `apps/api`)
Expected: PASS.

- [ ] **Step 5: Commit** as `feat(api): vendors repository`.

---

### Task 6: Vendors service

**Files:**
- Create: `apps/api/src/gm/vendors.service.ts`
- Modify: `apps/api/test/fakes.ts` (add `FakeVendorsRepository`)
- Test: `apps/api/test/vendors.service.test.ts`

**Interfaces:**
- Consumes: `VendorsRepository`, `GmRepository.writeAudit`, `itemIcons`, `npcFaces`, `MAP_NAMES`, `countryName`, `className`, Task 1's functions and types. `CONFIG` for `db.gameName`.
- Produces:

```ts
type Actor = { username: string; ip: string };
class VendorsService {
  list(): Promise<GmVendorList>;
  stock(vendorId: number): Promise<GmVendorItem[]>;
  addItem(vendorId: number, itemId: number, actor: Actor): Promise<GmVendorItem>;
  removeItem(vendorId: number, itemId: number, actor: Actor): Promise<void>;
  setPrice(itemId: number, input: ItemPriceInput, actor: Actor): Promise<GmItemPriceResult>;
  searchItems(q: string): Promise<GmItemSearchResult[]>;
}
/** The first class and country whose shop view exceeds 255 items, or null. Mirrors SendCS_NPCITEMLIST_ACK. */
export function shopOverflow(condition: number, stock: { classMask: number; itemCountry: number }[]):
  { classId: number; country: number } | null;
```

Rules:
- `FakeVendorsRepository` has public `vendors`, `items` and `stock` (`Map<vendorId, number[]>`) fields, and records `setPrice` calls in `prices` as `[itemId, column, multiplier]`.
- `inClient` is `Object.hasOwn(itemIcons, itemId)`. Tests can rely on real data: 8001 is in the client, 60 is not.
- Order of checks in `addItem`: vendor exists, in client, in `TITEMCHART`, not already sold, then `shopOverflow` on stock plus the new item.
- Overflow classes are bits 0 to 5, and countries are 0 and 1. An item counts when the class bit is set and (`itemCountry === 3`, or `itemCountry === country`, or `condition === 4`).
- `setPrice` computes `multiplier`, then `price = chargedPrice(base, multiplier)`, and rejects when `Math.max(amount, price) * Math.max(stack, 1) > MAX_PRICE`.
- A failed audit logs a warning and doesn't fail the request, as in `LoginsService.audit`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('list', () => {
  it('reports the database, shop type, country name, map name and face', async () => {
    const { database, vendors } = await service.list();
    expect(database).toBe('TGAME_GSP_TEST');
    expect(vendors[0]).toMatchObject({ id: 20002, shop: 'money', country: 'Defugel', mapName: 'Overworld', faceIcon: npcFaces[20002] });
  });
  it('gives a null face to an NPC not in the lookup');
});

describe('stock', () => {
  it('uses money for a money shop', /* base 475, fPrice 5: price 2375, multiplier 5 */);
  it('uses PvP values for a PvP shop', /* pvpMoney 2, fPvPrice 75: base 2, price 150 */);
  it('shows an unknown item with a null name, a null icon and price 0');
  it('404s for a non-vendor', () => expect(service.stock(1)).rejects.toThrow('That NPC is not a vendor'));
});

describe('addItem', () => {
  it('adds and audits', async () => {
    await service.addItem(20002, 8001, actor);
    expect(gm.audits).toEqual([expect.objectContaining({
      command: 'VENDORADD', gmId: 'moose', log: 'Mr Bab (20002): +8001 Small Vitality Potion' })]);
  });
  it('rejects a non-vendor with 404');
  it('rejects an item not in the client with 422', () =>
    expect(service.addItem(20002, 60, actor)).rejects.toThrow('Not in the game client, adding it would crash players opening this shop'));
  it('rejects an item not in the database with 422', /* 8001 with no fake item: 'Not in the game database, the server would ignore it' */);
  it('rejects a duplicate with 409', /* 'Already sold by this vendor' */);
  it('rejects a shop overflow with 422', /* 'Would exceed the 255 item shop limit for Warrior in Defugel' */);
  it('allows reaching exactly 255');
});

describe('shopOverflow', () => {
  const item = (classMask: number, itemCountry = 3) => ({ classMask, itemCountry });
  const many = (n: number, entry: ReturnType<typeof item>) => Array.from({ length: n }, () => entry);
  it('is null at 255', () => expect(shopOverflow(0, many(255, item(1)))).toBeNull());
  it('finds the class over 255', () => expect(shopOverflow(0, many(256, item(0b100)))).toEqual({ classId: 2, country: 0 }));
  it('ignores classes split across masks', () =>
    expect(shopOverflow(0, [...many(200, item(1)), ...many(200, item(2))])).toBeNull());
  it('counts faction items only in that faction', () =>
    expect(shopOverflow(0, [...many(200, item(1, 0)), ...many(200, item(1, 1))])).toBeNull());
  it('counts every faction item when the vendor is DCC_ALLCOUNTRY', () =>
    expect(shopOverflow(4, [...many(200, item(1, 0)), ...many(200, item(1, 1))])).toEqual({ classId: 0, country: 0 }));
});

describe('removeItem', () => {
  it('removes and audits', /* log 'Mr Bab (20002): -8001 Small Vitality Potion' */);
  it('404s when not sold', /* 'Not sold by this vendor' */);
  it('404s for a non-vendor');
});

describe('setPrice', () => {
  it('stores a money multiplier and audits old and new values', async () => {
    const result = await service.setPrice(8001, { currency: 'money', amount: 75 }, actor);
    expect(result).toEqual({ itemId: 8001, name: 'Small Vitality Potion', price: 75, multiplier: 75, soldBy: 12 });
    expect(repo.prices).toEqual([[8001, 'fPrice', 75]]);
    expect(gm.audits[0]).toMatchObject({ command: 'ITEMPRICE',
      log: '8001 Small Vitality Potion: fPrice 50 -> 75, 50 -> 75 cron' });
  });
  it('stores PvP in fPvPrice', /* log says '… fPvPrice 2 -> 3, 100 -> 150 points' with pvpMoney 50 */);
  it('allows a free item', /* amount 0, multiplier 0 */);
  it('404s for a missing item', /* 'Item not found' */);
  it('rejects base 0 with 422', /* "This item's level has no price, so it can't be set" */);
  it('rejects a stack overflow with 422', /* stack 100, amount 50,000,000: 'Price too high, buying a full stack would overflow' */);
  it('treats stack 0 as 1');
  it('still succeeds when the audit fails');
});

describe('searchItems', () => {
  it('marks items not in the client', /* 60 false, 8001 true */);
  it('reports both prices', /* money 1, fPrice 50, pvpMoney 1, fPvPrice 0: price 50, pvpPrice 0 */);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/vendors.service.test.ts` in `apps/api`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement** the service, using `NotFoundException`, `ConflictException` and `UnprocessableEntityException`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/vendors.service.test.ts` in `apps/api`
Expected: PASS.

- [ ] **Step 5: Commit** as `feat(api): vendor stock and price rules`.

---

### Task 7: Vendors routes

**Files:**
- Create: `apps/api/src/gm/vendors.controller.ts`
- Modify: `apps/api/src/gm/gm.module.ts`, `apps/api/test/test-app.ts`
- Test: `apps/api/test/gm-vendors.http.test.ts`

**Interfaces:**
- Consumes: `VendorsService`, Task 1's schemas.
- Produces the routes in spec 4.1. The controller is `@Controller('gm')` with `@UseGuards(SessionGuard, GmGuard)`. Writes add `@UseGuards(ThrottlerGuard)` and `@Throttle({ default: { limit: 30, ttl: 60_000 } })`. Route IDs use `new ZodValidationPipe(gmIdSchema)`, and `q` uses `new ZodValidationPipe(itemSearchQuerySchema)`. `POST` returns 201, `DELETE` 204, `PUT` 200. `createTestApp` takes a `vendors?: FakeVendorsRepository` override.

- [ ] **Step 1: Write the failing tests**, following `gm.http.test.ts`'s setup:

```ts
it.each(routes)('%s %s is 403 for a non-GM');   // all six routes, logged in as newuser
it.each(routes)('%s %s is 401 when logged out');
it('GET /gm/vendors returns the list');
it('GET /gm/vendors/:id/items returns stock');
it('POST adds and returns 201 with the row');
it('POST with a bad body is 400', /* { itemId: 'x' }, { itemId: 40000 } */);
it('DELETE removes and returns 204');
it('PUT sets a price', /* { currency: 'money', amount: 75 } */);
it('PUT with a negative amount is 400');
it('GET /gm/items requires q', /* missing and blank are 400 */);
it('passes the status and message of a rule failure through', /* add item 60: 422 with the crash message */);
it.each(['abc', '0', '-1', '32768', '99999999999'])('GET /gm/vendors/%s/items is 400', async (id) =>
  expect((await agent.get(`/api/gm/vendors/${id}/items`)).status).toBe(400));
it.each(['abc', '40000'])('DELETE with item id %s is 400');
it.each(['abc', '40000'])('PUT with item id %s is 400');
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/gm-vendors.http.test.ts` in `apps/api`
Expected: FAIL, routes are 404.

- [ ] **Step 3: Implement** the controller. Register `VendorsController`, `VendorsService` and `{ provide: VENDORS_REPOSITORY, useClass: SqlVendorsRepository }` in `GmModule`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run lint -w apps/api; npm test -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit** as `feat(api): GM vendor routes`.

---

### Task 8: Vendors page with vendor list

**Files:**
- Create: `apps/web/src/routes/_authed/gm/vendors.tsx`, `apps/web/src/components/gm/VendorList.tsx`, `apps/web/src/components/gm/GameIcon.tsx`
- Modify: `apps/web/src/components/gm/GmNav.tsx`, `apps/web/src/lib/gm.ts`, `apps/web/src/routeTree.gen.ts` (generated by the router plugin)
- Test: `apps/web/src/routes/gm-vendors.test.tsx`

**Interfaces:**
- Consumes: API routes, `GmVendor`, `GmVendorList`.
- Produces:
  - In `lib/gm.ts`: `gmVendorsQueryOptions` (key `['gm','vendors']`), `vendorStockQueryOptions(id)` (key `['gm','vendors',id,'items']`), `vendorDisplayName(vendor: GmVendor): string`.
  - `GameIcon`, props `{ spriteId: number | null; size: number }`. An `<img src="/game-icons/<id>.png" alt="" loading="lazy">`, or a neutral `aria-hidden` box when `spriteId` is null or the image fires `error`.
  - `VendorList`, props `{ vendors: GmVendor[]; selected?: number; onSelect: (id: number) => void }`.
  - Route search param `vendor?: number`, from `validateSearch`. Anything that isn't a positive integer becomes undefined.

- [ ] **Step 1: Write the failing tests**

```tsx
const vendor = (overrides = {}) => ({ id: 20002, name: 'Mr Bab', title: 'Trader', shop: 'money', country: 'Defugel',
  mapId: 0, mapName: 'Overworld', itemCount: 10, faceIcon: 6480, ...overrides })
const list = (vendors, database = 'TGAME_GSP') => () => json(200, { database, vendors })

it('sends a non-GM to /characters')
it('is reachable from the GM nav')
it('warns when editing a test copy', async () => {
  mockApi({ 'GET /gm/vendors': list([vendor()], 'TGAME_GSP_TEST') })
  renderRoute('/gm/vendors', { me: gm })
  expect(await screen.findByText("Editing TGAME_GSP_TEST. Players won't see this test copy.")).toBeInTheDocument()
  expect(screen.getByText('Changes reach players after TMapSvr restarts.')).toBeInTheDocument()
})
it('shows only the restart line on the live database')
it('filters as you type on name, title and id')
it('filters to PvP shops')
it('shows the portrait, and a placeholder when there is none or it fails to load', /* fireEvent.error */)
it('falls back to the title for a vendor with no name', /* name '' title 'Trader' */)
it('falls back to NPC id for a vendor with no name or title', async () => {
  mockApi({ 'GET /gm/vendors': list([vendor({ name: '', title: '' })]) })
  renderRoute('/gm/vendors', { me: gm })
  expect(await screen.findByRole('button', { name: /NPC 20002/ })).toBeInTheDocument()
})
it('selects a vendor into the URL and keeps it on load', /* router.state.location.search.vendor */)
it('says when a linked vendor does not exist', async () => {
  mockApi({ 'GET /gm/vendors': list([vendor()]) })
  renderRoute('/gm/vendors?vendor=30000', { me: gm })
  expect(await screen.findByText('That NPC is not a vendor.')).toBeInTheDocument()
})
it('ignores a garbage vendor param', /* ?vendor=abc: no error, prompt to pick a vendor */)
it('says when vendors cannot load', /* 400: alert 'Could not load vendors.' */)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/routes/gm-vendors.test.tsx` in `apps/web`
Expected: FAIL, route missing.

- [ ] **Step 3: Implement** with the spec 5.1 layout: `flex-col` on narrow screens and two columns from `md:` up. Copy the `beforeLoad` from `logins.tsx`, and add `<GmNav />`. The right pane shows the vendor header (portrait, display name, title if there is a name, country, map name or `Map <id>`). Task 9 fills in the stock.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build -w apps/web; npx vitest run src/routes/gm-vendors.test.tsx` (the second in `apps/web`)
Expected: PASS, with `routeTree.gen.ts` updated.

- [ ] **Step 5: Commit** as `feat(web): vendors page with vendor search`.

---

### Task 9: Stock table, price editing and removal

**Files:**
- Create: `apps/web/src/components/gm/VendorItemsTable.tsx`, `apps/web/src/components/gm/PriceEditor.tsx`
- Modify: `apps/web/src/routes/_authed/gm/vendors.tsx`, `apps/web/src/lib/gm.ts`
- Test: `apps/web/src/routes/gm-vendors.test.tsx`

**Interfaces:**
- Consumes: `chargedPrice`, `multiplierForPrice`, `sellBackPrice`, `splitMoney`, `joinMoney`, `GmVendorItem`.
- Produces, in `lib/gm.ts`:
  - `useRemoveVendorItem()`: variables `{ vendorId, itemId }`.
  - `useSetItemPrice()`: variables `{ itemId, currency, amount }`, returns `GmItemPriceResult`.
  - Both invalidate `['gm','vendors']` in `onSettled`, so a stale list refreshes after a failure too.
  - `priceLabel(price: number, shop: VendorShop): string`: `Free`, `0R 5L 0C`, or `150 points`.
  - `priceText(price: number, shop: VendorShop): string`: `75 cron` or `150 points`, with thousands separators.
- `VendorItemsTable` props: `{ vendor: GmVendor; items: GmVendorItem[]; onNote: (note: string) => void }`. It owns which row is being edited or confirmed.
- `PriceEditor` props: `{ item: GmVendorItem; shop: VendorShop; saving: boolean; error: string | null; onSave: (amount: number) => void; onCancel: () => void }`.

Copy, exactly as in the spec:
- `Sells back for 18 cron.`
- `Sold by 12 vendors: this changes all of them.`, shown only when `soldBy > 1`
- `Will charge 15,999,999 cron`, shown only when `chargedPrice` differs from the typed amount
- `Price can't be set: level 0 item`, shown when `base === 0` and `name !== null`
- Confirmation: `Remove Small Potion from Mr Bab?`
- Notes: `Small Potion now costs 75 cron at 12 vendors. Restart TMapSvr to apply.` (`1 vendor` when singular) and `Small Potion removed from Mr Bab. Restart TMapSvr to apply.`

- [ ] **Step 1: Write the failing tests**

```tsx
const item = (o = {}) => ({ itemId: 8001, name: 'Small Potion', level: 1, icon: 500, base: 1, multiplier: 50, price: 50, soldBy: 12, ...o })

it('lists stock with icon, level, split price and sold-by')
it('filters stock')
it('shows Free for a price of 0')
it('shows points for a PvP shop')
it('shows an unknown item, removable, with no edit button', /* name null: 'Unknown item #8001' */)
it('shows no edit button when the base is 0', /* base 0: "Price can't be set: level 0 item" */)
it('previews sell-back and warns about other vendors', async () => {
  // open editor, type Cron 75
  expect(screen.getByText('Sells back for 18 cron.')).toBeInTheDocument()
  expect(screen.getByText('Sold by 12 vendors: this changes all of them.')).toBeInTheDocument()
})
it('leaves out the vendor warning when only this vendor sells it', /* soldBy 1 */)
it('disables save until the price changes')
it('sends the joined amount and shows a note', async () => {
  // Rune 1, Luna 2, Cron 3
  expect(sentBodies(fetchMock, 'PUT /gm/items/8001/price')).toEqual([{ currency: 'money', amount: 1_002_003 }])
  expect(await screen.findByText(/now costs 1,002,003 cron at 12 vendors\. Restart TMapSvr to apply\./)).toBeInTheDocument()
})
it('edits one points field and hides sell-back on a PvP shop', /* currency 'pvp' */)
it('treats a blank field as 0', /* clear Cron, Rune 1: amount 1,000,000 */)
it('disables save for a negative or fractional value')
it('warns when the price cannot be charged exactly', /* base 53750, Rune 16: 'Will charge 15,999,999 cron' */)
it('keeps the typed values and shows the error when saving fails', /* 422 message in the row */)
it('closes the editor when another vendor is selected')
it('asks before removing and sends nothing on cancel', /* 'Remove Small Potion from Mr Bab?' */)
it('removes and shows a note', /* DELETE /gm/vendors/20002/items/8001 */)
it('refreshes after removing an item that was already gone', /* 404 message shown, stock refetched */)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/routes/gm-vendors.test.tsx` in `apps/web`
Expected: new tests FAIL.

- [ ] **Step 3: Implement.** Table styling matches `LoginsTable`. Inputs are plain controlled `type="number" min="0"` inputs labelled `Rune`, `Luna`, `Cron` or `PvP points`, styled like `DestinationSearch`. Row actions have `aria-label`s such as `Edit price of Small Potion` and `Remove Small Potion`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/routes/gm-vendors.test.tsx` in `apps/web`
Expected: PASS.

- [ ] **Step 5: Commit** as `feat(web): vendor stock table with price editing and removal`.

---

### Task 10: Adding items

**Files:**
- Create: `apps/web/src/components/gm/AddItemSearch.tsx`
- Modify: `apps/web/src/routes/_authed/gm/vendors.tsx` (renders the search above the stock table), `apps/web/src/lib/gm.ts`
- Test: `apps/web/src/routes/gm-vendors.test.tsx`

**Interfaces:**
- Consumes: `GmItemSearchResult`, `priceLabel`.
- Produces, in `lib/gm.ts`: `itemSearchQueryOptions(q)` (GET `/gm/items?q=<encoded>`), and `useAddVendorItem()` (variables `{ vendorId, itemId }`, returns `GmVendorItem`, invalidates `['gm','vendors']` in `onSettled`).
- `AddItemSearch` props: `{ vendor: GmVendor; soldItemIds: ReadonlySet<number>; onNote: (note: string) => void }`. Debounce the query by 250 ms with `useEffect`. Show `price` for a money shop and `pvpPrice` for a PvP shop.

Copy: `Already sold`, `Not in client`, and notes `Small Potion added to Mr Bab. Restart TMapSvr to apply.`, with ` It is free in this shop until you set a price.` added when the new row's price is 0.

- [ ] **Step 1: Write the failing tests**

```tsx
it('opens from + Add item and searches as you type', /* GET /gm/items?q=potion */)
it('encodes the search text', /* 'a&b' sends q=a%26b */)
it('shows icon, name, id, level and the price for this shop')
it('adds on click and shows a note', /* POST body { itemId }, stock refetched */)
it('says a newly added item is free', /* returned price 0 */)
it('greys out items already sold', /* disabled button, 'Already sold' */)
it('greys out items not in the client', /* disabled button, 'Not in client' */)
it('shows the error when adding fails', /* 422: shop limit message */)
it('says when nothing matches', /* 'No matching items.' */)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/routes/gm-vendors.test.tsx` in `apps/web`
Expected: new tests FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run to verify they pass**

Run: `npm run lint -w apps/web; npm test -w apps/web`
Expected: PASS.

- [ ] **Step 5: Commit** as `feat(web): add items to a vendor`.

---

### Task 11: Documentation and full verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the finished feature.
- Produces: docs and the user's in-game checklist.

- [ ] **Step 1: Update the README's GM tools section.** Change the opening sentence to include the vendor tool, and add a bullet covering:
  - what the tool edits, and that prices belong to the item, so they change at every vendor and change sell-back
  - edits reach players after every `TMapSvr` restarts
  - the client's sell-price tooltip stays on the old value until `TItem.tcd` changes, while the server pays the new one
  - icons and the lookup are committed in `apps/web/public/game-icons/` and `apps/api/src/gm/game-icons.generated.ts`, so after a client update run `npm run import:icons -w apps/api` and restart the API
  - writes are audited to `TMANAGERLOG` as `VENDORADD`, `VENDORDEL` and `ITEMPRICE`

- [ ] **Step 2: Run everything**

Run: `npm run lint; npm test; npm run test:db; npm run build`
Expected: all pass.

- [ ] **Step 3: Drive the page against `_TEST`** with the `run` skill. Confirm `.env` still names the `_TEST` databases first. Check: search a vendor, portraits and item icons appear, change a price and see the preview, add an item, remove it, the `_TEST` banner shows, and the layout stacks at phone width.

- [ ] **Step 4: Commit** as `docs: GM vendors tool`.

- [ ] **Step 5: Hand the user this checklist** in the final message, since it needs the live database, a `TMapSvr` restart and a client, none of which you may touch:
  1. Point `DB_GAME_NAME` and `DB_GLOBAL_NAME` at the live databases and restart the API.
  2. Change one cheap item's price, and add one item to a test vendor.
  3. Restart every `TMapSvr`.
  4. In game: open the shop and confirm it opens, the price shows correctly, buying charges that price, and selling pays a quarter of it.
  5. Confirm the audit rows exist, then revert the changes in the tool.

---

### Task 12: Coin icons and vendor list pane

Added after the user saw the page: `10R 50L 10C` looks wrong, so prices use the game's coin icons. Spec sections 2.7, 5.1, 5.2 and 5.5 were updated.

**Files:**
- Modify: `packages/shared/src/gm.ts`, `apps/api/src/gm/import-game-icons.ts`, `apps/web/src/components/gm/GameIcon.tsx`, `apps/web/src/components/gm/VendorItemsTable.tsx`, `apps/web/src/components/gm/PriceEditor.tsx`, `apps/web/src/components/gm/AddItemSearch.tsx`, `apps/web/src/components/gm/VendorList.tsx` or the route for the pane classes, `apps/web/src/lib/gm.ts`
- Create: `apps/web/src/components/gm/Price.tsx`
- Generate: `apps/web/public/game-icons/{11136,11137,11138}.png`
- Test: `packages/shared/src/gm.test.ts`, `apps/web/src/routes/gm-vendors.test.tsx`

**Interfaces:**
- Produces, in shared `gm.ts`: `COIN_SPRITES = { rune: 11137, luna: 11138, cron: 11136 } as const`.
- `GameIcon` gains an optional `alt` prop, default `''`.
- `Price`, props `{ price: number; shop: VendorShop }`. Inline, no wrapping, `tabular-nums`. Price 0: `Free`. PvP: `1,200 points`. Money: for each non-zero of rune, luna, cron in that order, the number with thousands separators then a 16px `GameIcon` with `alt` `Rune`, `Luna` or `Cron`.
- `priceLabel` is removed; everything that used it renders `Price`.
- `priceText(price, shop)` is words for notes: `1 Rune 2 Luna 3 Cron`, only non-zero parts, `75 Cron`, `150 points`, with thousands separators.

Copy:
- Save note: `Small Potion now costs 75 Cron at 12 vendors. Restart TMapSvr to apply.` For 0: `Small Potion is now free at 12 vendors. Restart TMapSvr to apply.`
- Editor: `Sells back for` then `<Price>`. When sell-back is 0: `Sells back for nothing.`
- Editor: `Will charge` then `<Price>`.
- The editor's Rune, Luna and Cron labels each show their coin next to the word, with an empty `alt` since the word is the label.

- [ ] **Step 1: Write the failing tests**

```ts
// shared
it('names the coin sprites', () => expect(COIN_SPRITES).toEqual({ rune: 11137, luna: 11138, cron: 11136 }));
```

```tsx
it('shows only non-zero denominations with their coins', async () => {
  // item price 5_200 in the stock table
  const cell = within(row).getByTestId('price')
  expect(cell).toHaveTextContent('5200')          // '5' + '200' with no R, L or C letters
  expect(within(cell).getByRole('img', { name: 'Luna' })).toHaveAttribute('src', '/game-icons/11138.png')
  expect(within(cell).getByRole('img', { name: 'Cron' })).toHaveAttribute('src', '/game-icons/11136.png')
  expect(within(cell).queryByRole('img', { name: 'Rune' })).not.toBeInTheDocument()
})
it('shows all three coins for a price with all three', /* 1_002_003: Rune 11137 too */)
it('uses no coins for a PvP price', /* '1,200 points', no img */)
it('shows Free with no coins for 0')
it('renders the sell-back with a coin', /* text 'Sells back for 18', img named Cron */)
it('says a free sell-back is nothing', /* price 3 sells back 0: 'Sells back for nothing.' */)
it('renders Will charge with coins', /* base 53750, Rune 16: 15 Rune, 999 Luna, 999 Cron */)
it('words the save note', /* 'now costs 1 Rune 2 Luna 3 Cron at 12 vendors' */)
it('says when an item becomes free', /* 'is now free at 12 vendors' */)
it('uses coins in add search results')
```

Update existing tests that assert `0R 5L 0C` or `cron` copy to the new forms.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w packages/shared; npx vitest run src/routes/gm-vendors.test.tsx` (the second in `apps/web`)
Expected: new tests FAIL.

- [ ] **Step 3: Implement.** The import script adds `COIN_SPRITES`' values to the wanted set, so they are written and never removed as stale, and fails with a clear error if any is absent from the extraction. From the two-column breakpoint up, the vendor list scrolls in its own pane using `md:max-h-[calc(100vh-…)]` and `md:overflow-y-auto`, keeping the search box and PvP checkbox outside the scrolling part.

- [ ] **Step 4: Run the import**

Run: `npm run import:icons -w apps/api`
Expected: PNGs written 2125, removed 0, and `git status` shows only the three new PNGs under `game-icons/`, with `game-icons.generated.ts` unchanged.

- [ ] **Step 5: Run the checks**

Run: `npm run build -w packages/shared; npm run lint; npm test`
Expected: PASS.

- [ ] **Step 6: Commit** as `feat(web): show prices with the game's coin icons`, staging by explicit path.
