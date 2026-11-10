import { EFFECT_KINDS, type GradeLayer, type GradeOp, layerKey } from '@4story-portal/shared';
import { ITEM_LAYOUT } from '../gm/game-icons-import.js';
import { ArchiveReader } from '../gm/game-places-import.js';
import {
  buildGlb,
  extractTexture,
  type ModelSources,
  parseObjectClothing,
  readTextureAnimation,
  type ReadResource,
  type ResourceEntry,
  textureSwatch,
  type VisualMesh,
  visualPart,
} from '../gm/mount-models-import.js';

// Weapon models and their grade effect layers, read from the game client. No file I/O here:
// weapon-catalog.ts supplies the files.

/** The human character object, ID_PLAYER_HUMAN in TClientID.h. Weapons drawn as part of the character live in it. */
export const ID_PLAYER_HUMAN = 0x000f56a4;

export type GradeVisual = { texture: number; op: number };

const KIND_COUNT = 19;
const CODED_SKIN_FIRST = 30;

/**
 * Skins 30 to 58, which CTChart::InitTITEMGRADEVISUAL (TChart.cpp:3781-3963) adds in code for every kind.
 * Copied as the client runs it: cases 7 and 14 have no break, so they take the next case's texture,
 * and cases 8 and 19 have none at all.
 */
const CODED_SKINS: (GradeVisual | null)[] = [
  { texture: 999233543, op: 6 },
  { texture: 999234560, op: 6 },
  { texture: 999232641, op: 6 },
  { texture: 999233308, op: 3 },
  { texture: 285967021, op: 3 },
  { texture: 999232553, op: 1 },
  { texture: 30000, op: 6 },
  { texture: 30003, op: 6 },
  null,
  { texture: 30003, op: 6 },
  { texture: 30004, op: 6 },
  { texture: 30005, op: 3 },
  { texture: 30006, op: 6 },
  { texture: 30007, op: 4 },
  { texture: 30009, op: 6 },
  { texture: 30009, op: 6 },
  { texture: 30010, op: 6 },
  { texture: 30011, op: 6 },
  { texture: 30012, op: 6 },
  null,
  { texture: 30014, op: 6 },
  { texture: 30015, op: 6 },
  { texture: 30016, op: 6 },
  { texture: 30017, op: 2 },
  { texture: 30018, op: 2 },
  { texture: 30019, op: 6 },
  { texture: 30020, op: 6 },
  { texture: 30021, op: 6 },
  { texture: 30022, op: 3 },
];

/** TItemGradeVisual.tcd plus the coded skins, keyed by `layerKey(kind, skin)`. File rows win, as std::map::insert keeps them. */
export function parseGradeVisualChart(file: Buffer): Map<string, GradeVisual> {
  const reader = new ArchiveReader(file);
  const chart = new Map<string, GradeVisual>();
  for (let count = reader.u16(); count > 0; count--) {
    const kind = reader.u8();
    const skin = reader.u16();
    const texture = reader.u32();
    const op = reader.u8();
    chart.set(layerKey(kind, skin), { texture, op });
  }
  reader.assertFinished();
  for (let kind = 0; kind < KIND_COUNT; kind++) {
    CODED_SKINS.forEach((visual, i) => {
      const key = layerKey(kind, CODED_SKIN_FIRST + i);
      if (visual && !chart.has(key)) chart.set(key, visual);
    });
  }
  return chart;
}

const GRADE_OPS: readonly number[] = [1, 2, 3, 4, 5, 6, 19];
/** Weapons and armour: the kinds the preview covers. */
const EFFECT_KIND_IDS = new Set<number>(EFFECT_KINDS.map(({ kind }) => kind));

/**
 * One layer per weapon or armour kind and skin whose texture the client has. A missing or empty texture, or
 * an op the client never uses, leaves no layer, as the client drops those rows when it loads.
 */
export function buildGradeLayers(
  chart: Map<string, GradeVisual>,
  textures: Map<number, ResourceEntry>,
  read: ReadResource,
): { layers: Record<string, GradeLayer>; pngs: Map<number, Buffer> } {
  const pngs = new Map<number, Buffer>();
  const missing = new Set<number>();
  const layers: Record<string, GradeLayer> = {};
  for (const [key, { texture, op }] of chart) {
    if (!EFFECT_KIND_IDS.has(Number(key.split(':')[0])) || texture === 0 || !GRADE_OPS.includes(op) || missing.has(texture)) continue;
    let png = pngs.get(texture);
    if (!png) {
      png = extractTexture(texture, textures, read) ?? undefined;
      if (!png) {
        missing.add(texture);
        continue;
      }
      pngs.set(texture, png);
    }
    const animation = readTextureAnimation(texture, textures, read);
    layers[key] = { texture, op: op as GradeOp, keys: animation?.keys ?? [], loopMs: animation?.loopMs ?? 0, swatch: textureSwatch(png) };
  }
  return { layers, pngs };
}

export type WeaponItem = { itemId: number; name: string; kind: number; level: number; visualId: number };

// Field positions in ITEM_LAYOUT.
const FIELD_ID = 0;
const FIELD_KIND = 2;
const FIELD_LEVEL = 10;
const FIELD_CAN_GRADE = 25;
const FIELD_VISUAL = 40;

/** The upgradable weapons and armour in TItem.tcd that have a look, with the names players see. */
export function parseWeaponItems(file: Buffer): WeaponItem[] {
  const reader = new ArchiveReader(file);
  const items: WeaponItem[] = [];
  for (let count = reader.u16(); count > 0; count--) {
    const fields: number[] = [];
    let name = '';
    for (const kind of ITEM_LAYOUT) {
      if (kind === 'b') fields.push(reader.u8());
      else if (kind === 'w') fields.push(reader.u16());
      else if (kind === 'd') fields.push(reader.u32());
      else if (kind === 'f') fields.push(reader.f32());
      else {
        name = reader.string();
        fields.push(0);
      }
    }
    if (EFFECT_KIND_IDS.has(fields[FIELD_KIND]) && fields[FIELD_CAN_GRADE] && fields[FIELD_VISUAL]) {
      items.push({ itemId: fields[FIELD_ID], name, kind: fields[FIELD_KIND], level: fields[FIELD_LEVEL], visualId: fields[FIELD_VISUAL] });
    }
  }
  reader.assertFinished();
  return items;
}

export type WeaponModelSources = Pick<ModelSources, 'objects' | 'meshes' | 'textures' | 'read'> & { visuals: Map<number, VisualMesh> };

/** A weapon's GLB: the mesh its visual selects in its own object, or in the human character's. */
export function buildWeaponModel(item: Pick<WeaponItem, 'visualId'>, sources: WeaponModelSources): Buffer {
  const visual = sources.visuals.get(item.visualId);
  if (!visual) throw new Error(`no visual ${item.visualId} in the client`);
  const objectId = visual.objectId || ID_PLAYER_HUMAN;
  const objectEntry = sources.objects.get(objectId);
  if (!objectEntry) throw new Error(`object ${objectId} is not in the client`);
  const part = visualPart(parseObjectClothing(sources.read(objectEntry), objectEntry.pos), visual, sources);
  if (!part) throw new Error(`visual ${item.visualId} has no mesh in object ${objectId}`);
  return buildGlb([part]);
}
