import { ArchiveReader } from './game-places-import.js';

// Reads the game client's item, NPC and UI-layout charts and works out which sprite each item icon
// and NPC face uses (see Extractor/src/lib/titem.js, titemvisual.js and tcml.js). No I/O here:
// import-game-icons.ts does that.

/** The UI controls holding the item icon sprites and the NPC face sprites. */
export const ITEM_ICON_LIST = 0x2169;
export const FACE_ICON_LIST = 26269;

export type ImageLists = Map<number, (number | null)[]>;
export type IconLookup = { itemIcons: Map<number, number | null>; npcFaces: Map<number, number> };

const INVALID_DWORD = 0xffffffff;
const TCML_TYPE_IMAGELIST = 0x0a;

// Field layouts as byte (b), word (w), dword (d), float (f) and CString (s), from the Extractor's
// ITEM_FIELDS and ITEM_VISUAL_FIELDS. The index names the field we keep.
export const ITEM_LAYOUT = 'wbbwswddbbbbdbfdbbbbbbbbbbbbwdbbbwbbffdbwwwwwwwwwbdbdbwbbdb';
const ITEM_VISUAL0_FIELD = 40;
export const ITEM_VISUAL_LAYOUT = 'wddddddddwbbbddfddd';
const ITEM_VISUAL_ICON_FIELD = 9;

export function readLayout(reader: ArchiveReader, layout: string): number[] {
  const values: number[] = [];
  for (const kind of layout) {
    switch (kind) {
      case 'b':
        values.push(reader.u8());
        break;
      case 'w':
        values.push(reader.u16());
        break;
      case 'd':
        values.push(reader.u32());
        break;
      case 'f':
        values.push(reader.f32());
        break;
      default:
        reader.string();
        values.push(0);
    }
  }
  return values;
}

export function parseItems(file: Buffer): { itemId: number; visualId: number }[] {
  const reader = new ArchiveReader(file);
  const items: { itemId: number; visualId: number }[] = [];
  for (let count = reader.u16(); count > 0; count--) {
    const fields = readLayout(reader, ITEM_LAYOUT);
    items.push({ itemId: fields[0], visualId: fields[ITEM_VISUAL0_FIELD] });
  }
  reader.assertFinished();
  return items;
}

export function parseItemVisuals(file: Buffer): Map<number, number> {
  const reader = new ArchiveReader(file);
  const visuals = new Map<number, number>();
  for (let count = reader.u16(); count > 0; count--) {
    const fields = readLayout(reader, ITEM_VISUAL_LAYOUT);
    visuals.set(fields[0], fields[ITEM_VISUAL_ICON_FIELD]);
  }
  reader.assertFinished();
  return visuals;
}

export function parseNpcTemplates(file: Buffer): Map<number, number> {
  const reader = new ArchiveReader(file);
  const faces = new Map<number, number>();
  for (let count = reader.u16(); count > 0; count--) {
    const id = reader.u16();
    reader.skip(4 + 19 * 2 + 1 + 1 + 1 + 4); // obj, items, action, two random bytes, snd
    faces.set(id, reader.u16());
    reader.skip(1); // box animation
  }
  reader.assertFinished();
  return faces;
}

/**
 * A file that stops mid-record is not an error: the records before it are kept and the result is
 * incomplete, so the import can report it. Every ArchiveReader read throws at the end of the buffer.
 */
export function parseNpcFile(file: Buffer): { npcs: { id: number; templateId: number }[]; complete: boolean } {
  const reader = new ArchiveReader(file);
  const npcs: { id: number; templateId: number }[] = [];
  try {
    for (let count = reader.u16(); count > 0; count--) {
      const id = reader.u32();
      const templateId = reader.u16();
      reader.string(); // name
      reader.string(); // title
      reader.skip(1 + 11); // type and 11 flags
      reader.skip(4 * 4 + 2 + 4 + 10 * 4 + 1); // house, menu, exec, quest, item, maxHp, 10 floats, camp
      npcs.push({ id, templateId });
    }
    reader.assertFinished();
  } catch {
    return { npcs, complete: false };
  }
  return { npcs, complete: true };
}

/** TNPC<8 hex digits>.tcd, one per map cell, and TNPCGlobal.tcd. Not TNPCTemp.tcd or TNPCPOS.tcd. */
export function isNpcFileName(name: string): boolean {
  return /^TNPC(?:[0-9a-f]{8}|Global)\.tcd$/i.test(name);
}

type Frame = { id: number; type: number; sprite: number | null; children: Frame[] };

// TClientCmd.tif is not a CArchive: its strings carry an int32 length instead of the CString prefix.
function readFrame(reader: ArchiveReader): Frame {
  const id = reader.u32();
  const type = reader.u8();
  reader.skip(12 * 4); // menus
  const sprite = reader.u32();
  reader.skip(4); // second image
  reader.skip(5 * 4 + 2 * 4 + 4 * 4 + 2 + 68);
  for (let i = 0; i < 2; i++) reader.skip(Math.max(reader.u32() | 0, 0)); // tooltip, text
  const children: Frame[] = [];
  for (let count = reader.u32() | 0; count > 0; count--) children.push(readFrame(reader));
  return { id, type, sprite: sprite === INVALID_DWORD ? null : sprite, children };
}

/** Per wanted id, the image list with the most children: the same pick as buildImageListIndexMap. */
export function parseImageLists(file: Buffer, wanted: number[]): ImageLists {
  const reader = new ArchiveReader(file);
  const best = new Map<number, Frame>();
  const visit = (frame: Frame) => {
    if (frame.type === TCML_TYPE_IMAGELIST && wanted.includes(frame.id)) {
      const seen = best.get(frame.id);
      if (!seen || frame.children.length > seen.children.length) best.set(frame.id, frame);
    }
    frame.children.forEach(visit);
  };
  for (let count = reader.u32() | 0; count > 0; count--) visit(readFrame(reader));

  const lists: ImageLists = new Map();
  for (const [id, frame] of best) lists.set(id, frame.children.map((child) => child.sprite));
  return lists;
}

export function buildIconLookup(input: {
  items: { itemId: number; visualId: number }[];
  visuals: Map<number, number>;
  templates: Map<number, number>;
  npcs: { id: number; templateId: number }[];
  lists: ImageLists;
}): IconLookup {
  const itemSprites = input.lists.get(ITEM_ICON_LIST) ?? [];
  const faceSprites = input.lists.get(FACE_ICON_LIST) ?? [];

  const itemIcons = new Map<number, number | null>();
  for (const { itemId, visualId } of input.items) {
    const index = input.visuals.get(visualId) ?? 0;
    itemIcons.set(itemId, index > 0 ? (itemSprites[index] ?? null) : null);
  }

  const npcFaces = new Map<number, number>();
  for (const { id, templateId } of input.npcs) {
    const face = input.templates.get(templateId) ?? 0;
    const sprite = face > 0 ? faceSprites[face] : null;
    if (sprite != null) npcFaces.set(id, sprite);
  }
  return { itemIcons, npcFaces };
}

export function usedSprites(lookup: IconLookup): Set<number> {
  const used = new Set<number>(lookup.npcFaces.values());
  for (const sprite of lookup.itemIcons.values()) if (sprite !== null) used.add(sprite);
  return used;
}

/** Every item keeps its key, with null where the sprite has no pixels; faces without pixels are left out. */
export function renderIconsFile(lookup: IconLookup, available: ReadonlySet<number>): string {
  const byId = ([a]: [number, unknown], [b]: [number, unknown]) => a - b;
  const items = [...lookup.itemIcons]
    .sort(byId)
    .map(([id, sprite]) => `  ${id}: ${sprite !== null && available.has(sprite) ? sprite : 'null'},`)
    .join('\n');
  const faces = [...lookup.npcFaces]
    .filter(([, sprite]) => available.has(sprite))
    .sort(byId)
    .map(([id, sprite]) => `  ${id}: ${sprite},`)
    .join('\n');
  return `// Generated by src/gm/import-game-icons.ts. Do not edit: rerun the import (see the README).
export const itemIcons: Readonly<Record<number, number | null>> = {
${items}
};
export const npcFaces: Readonly<Record<number, number>> = {
${faces}
};
`;
}
