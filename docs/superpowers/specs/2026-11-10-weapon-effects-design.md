# Weapon effects preview: design

Date: 2026-11-10. Status: waiting for review.

## Goal

Players can see what an upgraded weapon looks like in game, such as a +23 with each effect it could roll, before they spend scrolls. They can also see the real effect of a weapon someone has equipped.

## What the game does (from the client source)

- A grade effect is not a particle effect. It is a **second texture layer, blended over the whole weapon mesh** (D3D9 texture stage 1) and animated by scrolling or rotating its UVs. `CTClientObjBase::NewGradeObjTex`, `CTachyonObject::Render`, `TClientObjBase.cpp:3124`, `TachyonObject.cpp:1675`.
- **Which layer** (`CTClientItem::GetGradeVISUAL`, `TClientItem.cpp:433-723`):

  | Level | Look |
  |---|---|
  | +0 to +5 | none |
  | +6 to +10 | tier 1 (teal) |
  | +11 to +15 | tier 2 (green) |
  | +16 | tier 3 (gold) |
  | +17 to +24 | set by the item's rolled effect alone; nothing changes between +17 and +24 |

- **The effects.** The server rolls 1..39 at random when an item first reaches +17 (`CSHandler.cpp:7148`), so each has a 1 in 39 chance. They are named in `TClientGame.cpp:28544` (Sea, Fire, Lightning, Ice, Black, Pink, Storm, Nature, Magma, Neon Green, Magic Ice, Magic Blue, Shiny Pink, Magic Pink, Gold, Abyss, Curved Pink, Rainbow, Ruby, Galactic, and so on).
- **Client quirks**, shown as the game shows them and noted on the page:
  - E2 and E13 have no visual on weapons.
  - E1 (Rainbow) shows E3's texture.
  - E8 (Lime) shows E9's texture.
- **Where the definitions live:**
  - `Tcd\TItemGradeVisual.tcd`: item kind and skin to texture id and blend op.
  - The client adds skins 30 to 58 in code (`TChart.cpp:3781-3963`).
  - Each texture is a TEXTURESET in a `.TTX` archive. It holds UV keyframes (`tick, U, V, rotation, scaleU, scaleV`), a loop length in ms and a DDS image.
  - Blend ops used:

    | Op | Result |
    |---|---|
    | MODULATE | base·g |
    | MODULATE2X | 2·base·g |
    | MODULATE4X | 4·base·g |
    | ADD | base+g |
    | ADDSIGNED | base+g−0.5 |
    | ADDSIGNED2X | 2(base+g−0.5) |
    | MULTIPLYADD | base+base·g |

## Scope

- **In:** all upgradable weapons, item kinds 1 to 12:
  - Separate weapon objects: one-handed, left-hand, two-handed, axe, rod, wand.
  - Weapons drawn as a mesh of the character: cakram, bow, crossbow, multi-vajra, shield.
  - 432 distinct meshes.
  - A skin (`m_wMoggItemID`) shows the skin's model with the weapon's effect, as in game.
- **Out:** armour and cloak effects, which use the same layer and could come later. Particle SFX: the grade SFX tables in this client are empty.

## Design

### 1. Effect data, exported once

A new script, `npm run import:grade-effects -w apps/api`, follows the mount model importer and reads the client from `GAME_TCD_DIR`. It writes:

- **`apps/web/public/grade-effects/<textureId>.png`**: the roughly 40 effect textures, each a few KB.
- **`apps/web/public/grade-effects/effects.json`**:
  - The level tiers.
  - The effect list: id, the game's enum name, the display name, texture, op, UV keys and loop length, an average colour for a swatch, and whether it is visible on weapons.
  - Per-kind overrides where a kind's row differs.

The effect → skin mapping is copied from `GetGradeVISUAL` and the coded skins from `InitTITEMGRADEVISUAL`, with their line numbers in comments. Its unit tests pin the three quirks.

### 2. Weapon models, built on demand

These endpoints sit behind the session guard like the rest of the stats API:

- **`GET /api/weapon-models/:itemId.glb`**:
  - Looks the item up in the client's `TItem.tcd`, then in `TItemVisual` (object, clothing kind, cloth, mesh).
  - Builds a GLB with the existing `parseObjectClothing`, `parseMesh`, `extractTexture` and `buildGlb`.
  - Caches it under `apps/api/data/weapon-models/`, which is not in git.
  - Returns 404 for anything that isn't an upgradable weapon.
  - The client files are parsed once and kept in memory.
- **`GET /api/weapon-effects/weapons?q=&kind=`**: searches upgradable weapons by name. Each result has the item id, name, kind, required level and icon. Names come from the client chart, which is what players see.

### 3. Viewer (web)

`WeaponEffectViewer` is built on `MountViewer` (one WebGL context, orbit and auto-rotate).

- The weapon's materials get the effect through `onBeforeCompile`:
  - After lighting, `g = texture(effectMap, uvMatrix · uv)`, combined with the op formula.
  - This happens in display (sRGB) space, as D3D9 fixed-function did, then the result is clamped.
- The UV matrix comes from the keys each frame: interpolated at `time % loop`, then rotate about (0.5, 0.5), scale, and translate (`CTMath::GetUVMatrix`).
- Static weapon meshes have equal UV1 and UV2, so the first UV set is used.
- The viewer is lazy-loaded, so three.js only downloads on pages that use it.

### 4. Weapon Effects page (`/weapon-effects`)

- **Pickers:** a weapon search with a kind filter, and a `+` level slider from 0 to 24.
- **Effects from +17:**
  - A row of effect chips, each with the game name and a colour swatch.
  - Invisible ones are marked "no visible effect on weapons".
  - A note says that +17 to +24 look the same, and that each effect is a 1 in 39 roll that a Change Effect scroll can reroll.
- **Below +17:** the tier is shown, with no effect choice.
- **Link:** the weapon, level and effect are kept in the URL, so a look can be shared.

### 5. Character and inspect pages

- `GearItem` gains `gradeEffect` and `moggItemId`; both are already read from the database.
- An equipped weapon (main, second or long weapon slot) gets a "View in 3D" button. It opens the viewer with that item's model, real `+` level and real effect.
- The private parts of the profile stay private: only data Inspect already shows is used.

## Error handling

- Missing client files, or a weapon with no mesh, return 404 from the model endpoint. The viewer then says it couldn't be loaded.
- Browsers without WebGL see the same message `MountViewer` shows.
- If the effect data is missing, the page still shows the model without an effect, plus a note.

## Testing

- **Unit:**
  - The `TItemGradeVisual` parser.
  - TTX UV key parsing.
  - Effect → skin → texture, including the quirks.
  - UV matrix maths against `CTMath::GetUVMatrix`.
  - The op formulas.
- **API:** the model route (built, cached, 404 for non-weapons, behind login) and weapon search, on fixture files.
- **Web:** the page (pickers, URL state, invisible effects marked, viewer mocked as in `MountViewer.test`) and the inspect button.
- **Visual:** screenshots in headless Edge with a software renderer. Then you compare a few effects in game (for example Fire, Ice, Abyss and Galactic) before it counts as done.

## Open points

- Bows, crossbows and shields may be skinned meshes. In game those use UV1 for the effect; if any of them looks wrong, that kind can follow later.
- Players may run the pixel-shader path, which does the same ops; this was not read. Small colour differences are possible.
