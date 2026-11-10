# Weapon Effects Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 3D preview of any upgradable weapon with the game's real grade effect at any `+` level, plus a "View in 3D" link from equipped weapons.

**Architecture:**
- The API reads the game client's files at runtime from `GAME_TCD_DIR` and its sibling `Index`/`Data` folders.
- It serves:
  - A weapon search.
  - The effect table: layers with texture, blend op and UV keys.
  - Effect textures as PNG.
  - Weapon GLBs, built on demand and cached on disk.
- The web viewer loads the GLB with three.js and adds the effect as a second texture layer through `onBeforeCompile`. It blends in sRGB space with the client's D3D9 op and animates the UVs from the keys.

**Tech Stack:** NestJS, vitest and supertest; React 19, TanStack Router and Query, three 0.187; the existing parsers in `apps/api/src/gm/mount-models-import.ts`.

**Spec:** `docs/superpowers/specs/2026-11-10-weapon-effects-design.md`

**Deviation from the spec (agreed simplification):** effect data and textures are served by the API from the client files, like the models, instead of an import script with static files. There is no generated asset to keep in sync, and the client must be on the API's machine for models anyway.

## Global Constraints

- **Effect ids** 0..39 follow `TITEMGRADEEFFECT_TYPE` in `Lib\Own\TProtocol\include\NetCode.h:2316`. `MIN_GRADE_EFFECT_LEVEL` = 17. The maximum level is 24.
- **Skin per level** (`TClientItem.cpp:573-723`):

  | Level | Skin |
  |---|---|
  | 0 | none |
  | 1..5 | 0 |
  | 6..10 | 1 |
  | 11..15 | 2 |
  | 16 | 3 |
  | 17..24 | by effect (next row) |

- **Skin per effect** at 17..24:

  | Effects | Skins |
  |---|---|
  | SEA..MAGMA (1..9) | 4..12 |
  | NEON_GREEN..MAGIC_PINK (10..14) | 30..34 |
  | GOLD (15) | 3 |
  | ABYSS (16) | 35 |
  | QT_PINK (17) | 36 |
  | E1 (18) | 37 |
  | E3..E12 (20..29) | 39..48 |
  | E14..E22 (31..39) | 50..58 |

  E2 (19), E13 (30) and anything else map to skin 0.
- **Coded skins** (`TChart.cpp:3781-3963`), for kinds 0..18, skins 30..58: index i = skin − 30. These are inserted without overwriting rows from the file.

  | i | Texture | Op |
  |---|---|---|
  | 0 | 999233543 | 6 |
  | 1 | 999234560 | 6 |
  | 2 | 999232641 | 6 |
  | 3 | 999233308 | 3 |
  | 4 | 285967021 | 3 |
  | 5 | 999232553 | 1 |
  | 6 | 30000 | 6 |
  | 7 | 30003 | 6 (missing `break`) |
  | 8 | none | |
  | 9 | 30003 | 6 |
  | 10 | 30004 | 6 |
  | 11 | 30005 | 3 |
  | 12 | 30006 | 6 |
  | 13 | 30007 | 4 |
  | 14 | 30009 | 6 (missing `break`) |
  | 15 | 30009 | 6 |
  | 16 | 30010 | 6 |
  | 17 | 30011 | 6 |
  | 18 | 30012 | 6 |
  | 19 | none | |
  | 20 | 30014 | 6 |
  | 21 | 30015 | 6 |
  | 22 | 30016 | 6 |
  | 23 | 30017 | 2 |
  | 24 | 30018 | 2 |
  | 25 | 30019 | 6 |
  | 26 | 30020 | 6 |
  | 27 | 30021 | 6 |
  | 28 | 30022 | 3 |

- **Ops** (PSTYPE): 1 modulate, 2 modulate2x, 3 modulate4x, 4 add, 5 addSigned, 6 addSigned2x, 19 multiplyAdd. Results are clamped to [0, 1].
- **UV keys:** `{tick u32, u f32, v f32, rotation f32, scaleU f32, scaleV f32}`. The current tick is `time % totalTick`, and values are interpolated linearly between keys (`T3D.h` `GetUV`). With no keys the transform is the identity.
- **UV matrix** (`TMath.cpp` `GetUVMatrix`, row vectors), applied to (u, v, 1):
  1. translate (−0.5, −0.5)
  2. rotate: u' = u·cos r + v·sin r, v' = −u·sin r + v·cos r
  3. scale (scaleU, scaleV)
  4. translate (0.5, 0.5)
  5. translate (u, v)
- **Weapon kinds** 1..12: 1 One-handed, 2 Left-hand, 3 Two-handed, 4 Cakram, 5 Axe, 6 Bow, 7 Crossbow, 8 Staff, 9 Wand, 10 Vajra, 11 Multi-vajra, 12 Shield.
- **Model object:** a visual with `ObjectID` 0 is a mesh of the human character object `ID_PLAYER_HUMAN` = 0x000F56A4.
- **Effect names** (`TClientGame.cpp:28544`, `TClientType.h:837`):

  | Id | Name | Id | Name | Id | Name |
  |---|---|---|---|---|---|
  | 1 | Sea | 14 | Magic Pink | 27 | Sunrise |
  | 2 | Fire | 15 | Gold | 28 | Underworld |
  | 3 | Lightning | 16 | Abyss | 29 | Prisma |
  | 4 | Ice | 17 | Curved Pink | 30 | none |
  | 5 | Black | 18 | Rainbow | 31 | Matrix |
  | 6 | Pink | 19 | none | 32 | Orange |
  | 7 | Storm Blue | 20 | none | 33 | Galactic |
  | 8 | Poison Green | 21 | Ruby | 34 | Copper |
  | 9 | Magma | 22 | Coral | 35 | Violet |
  | 10 | Neon Green | 23 | Ecstasy | 36 | Contrast |
  | 11 | Magic Ice | 24 | Emerald | 37 | none |
  | 12 | Magic Blue | 25 | Lime | 38 | none |
  | 13 | Shiny Pink | 26 | none | 39 | Storm Red |

  Effect n of the `IE_E1..IE_E22` range is id 17 + n.

  An effect without a name shows as `Effect <id>`.
- **Notes shown on the page:**
  - 18 (Rainbow): "Shows the same look as effect 20 in game."
  - 25 (Lime): "Shows the same look as effect 26 in game."
  - 19 and 30: "No visible effect on weapons in game."
- **Out of scope:** armour and cloak effects, and particle SFX.

## Review Focus

- **The client folder is missing or not configured.** The effect and weapon routes answer 503 "Weapon previews are not available", the page shows that message, and nothing crashes at startup. *Test in Task 3.*
- **An item id that isn't an upgradable weapon** (armour, a potion, a non-existent id) gets a 404 from the model route, and the viewer says it couldn't be loaded. *Test in Task 3.*
- **Odd URL values:** level above 24 or negative, effect above 39, a non-numeric item. The page clamps to valid values instead of failing. *Test in Task 5.*
- **A skinned item** (`moggItemId`) previews the skin's model with the item's own level and effect. *Test in Task 6.*
- **A layer whose texture is missing** in the client is treated as no effect, not as an error. *Test in Task 2.*

---

### Task 1: Shared effect rules

**Files:**
- Create: `packages/shared/src/weapon-effects.ts`
- Create: `packages/shared/src/weapon-effects.test.ts`
- Modify: `packages/shared/src/index.ts` (export the new file)

**Interfaces:**
- **Produces:**
  - `MAX_ITEM_LEVEL = 24`, `MIN_GRADE_EFFECT_LEVEL = 17`
  - `WEAPON_KINDS: { kind: number; name: string }[]`
  - `GRADE_EFFECTS: { id: number; name: string; note: string | null }[]`, for ids 1..39
  - `gradeSkin(level: number, effect: number): number | null`. Null means no layer, at level 0.
  - `type GradeOp`, numeric ops 1..6 and 19
  - `type UvKey = { tick; u; v; rotation; scaleU; scaleV }`
  - `type GradeLayer = { texture: number; op: GradeOp; keys: UvKey[]; loopMs: number; swatch: string }`
  - `type WeaponEffectsData = { layers: Record<string, GradeLayer> }`, keyed `"<kind>:<skin>"`
  - `layerKey(kind, skin)`
  - `type WeaponSearchResult = { itemId; name; kind; level; icon: number | null }`
  - `weaponSearchSchema`, a zod object of `q` (0..40 chars, trimmed) and optional `kind` (1..12)

- [ ] **Step 1:** Write tests:
  - `gradeSkin(0, 5)` → null; `gradeSkin(3, 0)` → 0; `gradeSkin(6, 0)` → 1; `gradeSkin(15, 9)` → 2; `gradeSkin(16, 0)` → 3.
  - `gradeSkin(17, 2)` → 5; `gradeSkin(24, 15)` → 3; `gradeSkin(20, 16)` → 35; `gradeSkin(17, 18)` → 37; `gradeSkin(17, 19)` → 0; `gradeSkin(17, 20)` → 39; `gradeSkin(17, 30)` → 0; `gradeSkin(17, 39)` → 58; `gradeSkin(17, 0)` → 0.
  - `GRADE_EFFECTS` has 39 entries; id 7 is "Storm Blue"; id 26 is "Effect 26"; id 33 is "Galactic"; id 19 has the no-visible-effect note.
  - `weaponSearchSchema` rejects `kind=13` and accepts `{ q: ' bow ' }` as `'bow'`.
- [ ] **Step 2:** Run `npx vitest run src/weapon-effects.test.ts` in `packages/shared`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement from the Global Constraints tables.
- [ ] **Step 4:** Run again. Expected: PASS. Then `npm run build -w packages/shared`.
- [ ] **Step 5:** Commit: `feat(shared): weapon effect rules`.

### Task 2: Client file parsers

**Files:**
- Modify: `apps/api/src/gm/mount-models-import.ts`:
  - `parseTextureRecord` keeps `keys` and `totalTick`.
  - Export `readTextureAnimation(id, index, read): { keys: UvKey[]; loopMs: number } | null`.
  - Export `textureSwatch(png: Buffer): string`, the average colour as `#rrggbb`.
  - `parseVisualMeshes` also returns `objectId` (field 2).
- Create: `apps/api/src/weapons/weapon-client.ts`:
  - `parseGradeVisualChart(file): Map<string, { texture: number; op: number }>`: the file rows, then the coded skins inserted without overwriting.
  - `parseWeaponItems(file): WeaponItem[]`, where `WeaponItem = { itemId; name; kind; level; canGrade: boolean; visualId }` (fields 0, 4, 2, 10, 25, 40 of `ITEM_LAYOUT`, keeping the name string). Only kinds 1..12 with `canGrade`.
  - `buildWeaponModel(item, sources): Buffer`: the object is `visual.objectId || ID_PLAYER_HUMAN`, then cloth kind, cloth and mesh as in `buildMountModel`; throws when no mesh is found.
- Test: `apps/api/test/weapon-client.test.ts`

**Interfaces:**
- **Consumes:** `UvKey` and `layerKey` from Task 1.
- **Produces:** the functions above. `type ClientSources = ModelSources & { visuals: Map<number, VisualMesh & { objectId: number }> }`.

- [ ] **Step 1:** Write tests on hand-built buffers:
  - A grade chart with 2 file rows, (kind 1, skin 3, texture 1089470, op 5) and (kind 1, skin 30, texture 77, op 2). Expect the file's skin-30 row to win over the coded one for kind 1, and kind 2 skin 30 to be the coded 999233543 with op 6.
  - Kind 5 skin 37 has texture 30003; skin 38 has no entry; skin 44 has texture 30009.
  - A texture record with 2 UV keys `{0, 0,0,0,1,1}` and `{3000, 0,1,0,1,1}`, total 3000, survives `readTextureAnimation`.
  - A record with no pixels and no frames gives null from `extractTexture` and from the layer builder.
  - `parseWeaponItems` on a 2-item buffer (a kind 1 sword and a kind 13 armour) returns only the sword, with its name.
  - `buildWeaponModel` throws for a visual whose object has no matching mesh.
- [ ] **Step 2:** Run `npx vitest run test/weapon-client.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS. The existing `mount-models-import.test.ts` still passes.
- [ ] **Step 5:** Commit: `feat(api): parse grade visuals, weapon items and texture animation`.

### Task 3: Weapon effect routes

**Files:**
- Modify: `apps/api/src/config/config.ts`: optional `GAME_TCD_DIR`; `WEAPON_MODEL_CACHE_DIR`, default `./data/weapon-models`.
- Create:
  - `apps/api/src/weapons/weapon-catalog.ts`
  - `apps/api/src/weapons/weapons.controller.ts`
  - `apps/api/src/weapons/weapons.module.ts`
- Modify: `apps/api/src/app.module.ts` (import the module).
- Modify: `apps/api/test/test-app.ts` (accept a fake catalog source).
- Test: `apps/api/test/weapons.http.test.ts`

**Interfaces:**
- **`WeaponCatalog`** (injectable):
  - `effects(): WeaponEffectsData`
  - `search(q, kind?): WeaponSearchResult[]` (at most 60, by level then name)
  - `texture(id): Buffer`
  - `model(itemId): Promise<Buffer>`
- **Client files** load once through `WEAPON_CLIENT_SOURCE`, a provider of type `() => ClientFiles`. When the files are missing, it throws `WeaponsUnavailableError`, which the routes turn into 503.
- **Routes**, all behind `SessionGuard`:
  - `GET /api/weapon-effects` → `WeaponEffectsData`.
  - `GET /api/weapon-effects/weapons?q&kind` → `WeaponSearchResult[]`.
  - `GET /api/weapon-effects/textures/:id.png` → `image/png`.
  - `GET /api/weapon-models/:itemId.glb` → `model/gltf-binary`, cached as `<cache>/<itemId>.glb`.
  - Binaries are sent with `Cache-Control: private, max-age=86400`.
  - The model route serves the `moggItemId` given as `?skin=` when that is an upgradable weapon too.

- [ ] **Step 1:** Write tests with a fake source holding 2 weapons (one with a mesh, one without) and 1 layer:
  - Every route is 401 when logged out.
  - Search by `q` and by `kind`.
  - Effects return the layer with its `swatch`.
  - The texture is PNG bytes.
  - A model's first request builds it and the second is read from the cache (the build counter stays at 1).
  - 404 for an unknown id or a non-weapon.
  - 503 on every route when the source throws `WeaponsUnavailableError`.
- [ ] **Step 2:** Run `npx vitest run test/weapons.http.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The real source reads like `import-mount-models.ts`: `TItem.tcd`, `TItemVisual.tcd`, `TItemGradeVisual.tcd`, and `Index\TClientO.IDX`, `TClientM.IDX`, `0_TClientS.IDX`.
- [ ] **Step 4:** Run again. Expected: PASS. Run `npx tsc --noEmit` and the whole API suite.
- [ ] **Step 5:** Commit: `feat(api): weapon effect and weapon model routes`.

### Task 4: Effect layer and viewer

**Files:**
- Create: `apps/web/src/lib/weapon-effects.ts`:
  - The query options.
  - `uvAt(keys, loopMs, timeMs): UvKey`
  - `uvMatrix(key): number[]` (3×3, column-major for `Matrix3.fromArray`)
  - `blendGlsl(op): string`, a GLSL expression of `base` and `g`
- Create: `apps/web/src/lib/weapon-effects.test.ts`
- Create: `apps/web/src/components/weapons/WeaponViewer.tsx`, the default export, lazy-loaded. It follows `MountViewer`'s stage and adds `setLayer(layer: GradeLayer | null)`.

**Interfaces:**
- **Consumes:** `GradeLayer`, `UvKey` and `GradeOp` from Task 1, and the routes from Task 3.
- **Produces:** `<WeaponViewer itemId={number} skinId={number | null} layer={GradeLayer | null} name={string} />`.

- [ ] **Step 1:** Write tests:
  - `uvAt` with keys at 0 ms (v 0) and 3000 ms (v 1) gives v 0.5 at 1500 ms and v 0 at 3000 ms (the loop restarts).
  - No keys gives the identity key.
  - One key gives that key.
  - `uvMatrix` with rotation π/2 and scale 1 maps (1, 0.5) to (0.5, 0).
  - `uvMatrix` with u = 0.25 maps (0, 0) to (0.25, 0).
  - `blendGlsl(6)` is `clamp(2.0 * (base + g - 0.5), 0.0, 1.0)`.
  - `blendGlsl(19)` is `clamp(base + base * g, 0.0, 1.0)`.
- [ ] **Step 2:** Run `npx vitest run src/lib/weapon-effects.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the lib.
  - In the viewer, for each material of the loaded GLB, set `onBeforeCompile` to add `uniform sampler2D gradeMap; uniform mat3 gradeUv;`.
  - After `#include <colorspace_fragment>`, add: `vec3 base = gl_FragColor.rgb; vec3 g = texture2D(gradeMap, (gradeUv * vec3(vUv, 1.0)).xy).rgb; gl_FragColor.rgb = <blend>;`.
  - The grade texture uses `NoColorSpace` and `RepeatWrapping`.
  - Each frame, update `gradeUv` from `uvAt(keys, loopMs, performance.now())`.
  - Changing the layer only swaps uniforms or recompiles; it doesn't reload the model.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): weapon viewer with grade effect layer`.

### Task 5: Weapon Effects page

**Files:**
- Create: `apps/web/src/routes/_authed/weapon-effects.tsx`
- Create: `apps/web/src/routes/weapon-effects.test.tsx`
- Modify: `apps/web/src/routes/_authed.tsx`: a nav link "Weapon Effects" after "Upgrade Stats".

**Interfaces:**
- **Consumes:** Tasks 1, 3 and 4.
- **Search params:** `{ item?: number; level: number (0..24, default 17); effect: number (1..39, default 1); skin?: number }`. Out-of-range values are clamped.

- [ ] **Step 1:** Write tests (the viewer is mocked like `MountViewer`):
  - The header link works, and the page needs login.
  - The weapon search lists results, and picking one sets `?item=`.
  - At `level=17`, the 39 effect chips show, with names; Storm Blue is present.
  - The chip for 19 carries "No visible effect on weapons in game".
  - Picking a chip updates `?effect=`, and the viewer gets that effect's layer.
  - At `level=12`, there are no chips and the text says "+11 to +15".
  - `level=99&effect=0` shows +24 with effect 1.
  - A 503 from the effects route shows "Weapon previews are not available right now."
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Lay it out like the other pages:
  - A filter card with the search and kind select.
  - A level slider with ±1 buttons.
  - The viewer card.
  - Effect chips with swatch, name and note.
  - A short explanation: +17..+24 look the same, each effect is a 1 in 39 roll, and a Change Effect scroll rerolls it.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): weapon effects page`.

### Task 6: View in 3D from equipped weapons

**Files:**
- Modify: `packages/shared/src/player-stats.ts`: `GearItem` gains `gradeEffect: number` and `moggItemId: number`.
- Modify: `apps/api/src/stats/stats.service.ts`, `gearViews`, to pass both.
- Modify: `apps/web/src/components/items/CharacterGear.tsx`: under the weapons row, a link "View in 3D" for each equipped weapon in slots 0..2 whose item kind is 1..12. It goes to `/weapon-effects?item=<itemId>&level=<upgrade>&effect=<gradeEffect>&skin=<moggItemId if not 0>`.
- Tests: `apps/api/test/inspect.http.test.ts` (fields present), `apps/web/src/components/items/CharacterGear.test.tsx` (link URL).

- [ ] **Step 1:** Write tests:
  - Inspect returns `gradeEffect: 7` and `moggItemId: 0` for the fixture weapon.
  - `CharacterGear` with a +23 main weapon (effect 7, mogg 9001) links to `/weapon-effects?item=…&level=23&effect=7&skin=9001`.
  - Armour gets no link.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The kind isn't on `GearItem`, so decide by slot: slots 0, 1 and 2 are weapon slots.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: view equipped weapons in 3D with their effect`.

### Task 7: Check, document, ship

- [ ] Lint, build, all API, web and database suites.
- [ ] Headless Edge (`--use-angle=swiftshader --enable-unsafe-swiftshader`) screenshots at desktop and phone width of a sword at +17 Fire, +23 Galactic and +12, plus a bow and a shield. Look at them and fix what's off.
- [ ] Add a ledger entry and update memory.
- [ ] Merge `feat/weapon-effects` into `main` and push.
