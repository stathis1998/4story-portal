import { z } from 'zod';

// How the game client picks the glowing layer on an upgraded weapon. Copied from
// CTClientItem::GetGradeVISUAL (TClient/TClientItem.cpp:573-723) and the effect enum
// TITEMGRADEEFFECT_TYPE (NetCode.h:2316), so ids and skins must never be renumbered.

export const MAX_ITEM_LEVEL = 24;
/** From this level the look depends on the effect the item rolled, not on the level. */
export const MIN_GRADE_EFFECT_LEVEL = 17;

export const WEAPON_KINDS = [
  { kind: 1, name: 'One-handed' },
  { kind: 2, name: 'Left-hand' },
  { kind: 3, name: 'Two-handed' },
  { kind: 4, name: 'Cakram' },
  { kind: 5, name: 'Axe' },
  { kind: 6, name: 'Bow' },
  { kind: 7, name: 'Crossbow' },
  { kind: 8, name: 'Staff' },
  { kind: 9, name: 'Wand' },
  { kind: 10, name: 'Vajra' },
  { kind: 11, name: 'Multi-vajra' },
  { kind: 12, name: 'Shield' },
] as const;

/** Armour takes the same layers (TItemGradeVisual.tcd has rows for kinds 1 to 18). Cloaks (19) work differently and are left out. */
export const ARMOR_KINDS = [
  { kind: 13, name: 'Cloth' },
  { kind: 14, name: 'Uniform' },
  { kind: 15, name: 'Light leather' },
  { kind: 16, name: 'Heavy leather' },
  { kind: 17, name: 'Light armour' },
  { kind: 18, name: 'Heavy armour' },
] as const;

/** Every item kind the effect preview covers. */
export const EFFECT_KINDS: readonly { kind: number; name: string }[] = [...WEAPON_KINDS, ...ARMOR_KINDS];

const NO_VISUAL = 'No visible effect on weapons in game.';

// Names from CTClientGame::AddEffectString (TClientGame.cpp:28544) and TClientType.h:837.
// Ids 18 to 39 are IE_E1 to IE_E22; those the client never names are left out.
const NAMES: Record<number, string> = {
  1: 'Sea',
  2: 'Fire',
  3: 'Lightning',
  4: 'Ice',
  5: 'Black',
  6: 'Pink',
  7: 'Storm Blue',
  8: 'Poison Green',
  9: 'Magma',
  10: 'Neon Green',
  11: 'Magic Ice',
  12: 'Magic Blue',
  13: 'Shiny Pink',
  14: 'Magic Pink',
  15: 'Gold',
  16: 'Abyss',
  17: 'Curved Pink',
  18: 'Rainbow',
  21: 'Ruby',
  22: 'Coral',
  23: 'Ecstasy',
  24: 'Emerald',
  25: 'Lime',
  27: 'Sunrise',
  28: 'Underworld',
  29: 'Prisma',
  31: 'Matrix',
  32: 'Orange',
  33: 'Galactic',
  34: 'Copper',
  35: 'Violet',
  36: 'Contrast',
  39: 'Storm Red',
};

// Quirks of the client: two cases fall through to the next one in CTChart::InitTITEMGRADEVISUAL,
// and two effects have no case in GetGradeVISUAL.
const NOTES: Record<number, string> = {
  18: 'Shows the same look as effect 20 in game.',
  19: NO_VISUAL,
  25: 'Shows the same look as effect 26 in game.',
  30: NO_VISUAL,
};

export const GRADE_EFFECTS: readonly { id: number; name: string; note: string | null }[] = Array.from({ length: 39 }, (_, i) => {
  const id = i + 1;
  return { id, name: NAMES[id] ?? `Effect ${id}`, note: NOTES[id] ?? null };
});

/** Effects 1 to 9 use skins 4 to 12, 10 to 14 use 30 to 34, and so on. */
function effectSkin(effect: number): number {
  if (effect >= 1 && effect <= 9) return effect + 3;
  if (effect >= 10 && effect <= 14) return effect + 20;
  if (effect === 15) return 3;
  if (effect === 16) return 35;
  if (effect === 17) return 36;
  if (effect === 18) return 37;
  if (effect >= 20 && effect <= 29) return effect + 19;
  if (effect >= 31 && effect <= 39) return effect + 19;
  return 0;
}

/** The grade skin for a `+` level and effect, or null at +0, where the item has no layer at all. */
export function gradeSkin(level: number, effect: number): number | null {
  if (level <= 0) return null;
  if (level <= 5) return 0;
  if (level <= 10) return 1;
  if (level <= 15) return 2;
  if (level === 16) return 3;
  return effectSkin(effect);
}

/** D3DTEXTUREOP values the client uses (PSTYPE in D3DDevice.h). */
export type GradeOp = 1 | 2 | 3 | 4 | 5 | 6 | 19;

/** One UV keyframe of an animated texture: offset, rotation in radians, and scale. */
export type UvKey = { tick: number; u: number; v: number; rotation: number; scaleU: number; scaleV: number };

export type GradeLayer = {
  texture: number;
  op: GradeOp;
  keys: UvKey[];
  /** The animation repeats every this many milliseconds; 0 means it stands still. */
  loopMs: number;
  /** The texture's average colour, `#rrggbb`. */
  swatch: string;
};

/** Layers keyed by `layerKey(kind, skin)`. A missing key means no visible layer. */
export type WeaponEffectsData = { layers: Record<string, GradeLayer> };

export const layerKey = (kind: number, skin: number) => `${kind}:${skin}`;

export type WeaponSearchResult = { itemId: number; name: string; kind: number; level: number; icon: number | null };

export const weaponSearchSchema = z.object({
  q: z.string().trim().max(40).optional(),
  kind: z.coerce.number().int().min(1).max(18).optional(),
});
export type WeaponSearch = z.infer<typeof weaponSearchSchema>;
