import { describe, expect, it } from 'vitest';
import {
  buildIconLookup,
  FACE_ICON_LIST,
  ITEM_ICON_LIST,
  isNpcFileName,
  parseImageLists,
  parseItems,
  parseItemVisuals,
  parseNpcFile,
  parseNpcTemplates,
  renderIconsFile,
  usedSprites,
} from '../src/gm/game-icons-import.js';
import { ArchiveWriter } from './archive-writer.js';

const ITEM_LAYOUT = 'wbbwswddbbbbdbfdbbbbbbbbbbbbwdbbbwbbffdbwwwwwwwwwbdbdbwbbdb';
const VISUAL_LAYOUT = 'wddddddddwbbbddfddd';

// Writes a record of the given layout, with `set` overriding fields by index.
function writeLayout(w: ArchiveWriter, layout: string, set: Record<number, number>) {
  [...layout].forEach((kind, i) => {
    const v = set[i] ?? 0;
    if (kind === 'b') w.u8(v);
    else if (kind === 'w') w.u16(v);
    else if (kind === 'd') w.u32(v);
    else if (kind === 'f') w.f32(v);
    else w.str('Sword');
  });
}

const pad = (w: ArchiveWriter, extra: number) => {
  for (let i = 0; i < extra; i++) w.u8(0);
  return w.toBuffer();
};

const itemsFile = (rows: [number, number][], extra = 0) => {
  const w = new ArchiveWriter().u16(rows.length);
  for (const [id, visual] of rows) writeLayout(w, ITEM_LAYOUT, { 0: id, 40: visual });
  return pad(w, extra);
};

const visualsFile = (rows: [number, number][], extra = 0) => {
  const w = new ArchiveWriter().u16(rows.length);
  for (const [id, icon] of rows) writeLayout(w, VISUAL_LAYOUT, { 0: id, 9: icon });
  return pad(w, extra);
};

const templatesFile = (rows: [number, number][], extra = 0) => {
  const w = new ArchiveWriter().u16(rows.length);
  for (const [id, face] of rows) {
    w.u16(id).u32(0);
    for (let i = 0; i < 19; i++) w.u16(0);
    w.u8(0).u8(0).u8(0).u32(0).u16(face).u8(0);
  }
  return pad(w, extra);
};

function writeNpc(w: ArchiveWriter, id: number, templateId: number) {
  w.u32(id).u16(templateId).str('Merchant').str('');
  for (let i = 0; i < 12; i++) w.u8(0);
  w.u32(0).u32(0).u32(0).u32(0).u16(0).u32(100);
  for (let i = 0; i < 10; i++) w.f32(1);
  w.u8(0);
}

const npcFile = (rows: [number, number][]) => {
  const w = new ArchiveWriter().u16(rows.length);
  for (const [id, template] of rows) writeNpc(w, id, template);
  return w.toBuffer();
};

describe('chart parsers', () => {
  it('parseItems reads id and first visual, and rejects leftover bytes', () => {
    expect(
      parseItems(
        itemsFile([
          [3, 10],
          [4, 11],
        ]),
      ),
    ).toEqual([
      { itemId: 3, visualId: 10 },
      { itemId: 4, visualId: 11 },
    ]);
    expect(() => parseItems(itemsFile([[3, 10]], 1))).toThrow(/bytes/);
  });

  it('parseItemVisuals maps visual id to icon index, and rejects leftover bytes', () => {
    expect([
      ...parseItemVisuals(
        visualsFile([
          [10, 5],
          [11, 0],
        ]),
      ),
    ]).toEqual([
      [10, 5],
      [11, 0],
    ]);
    expect(() => parseItemVisuals(visualsFile([[10, 5]], 1))).toThrow(/bytes/);
  });

  it('parseNpcTemplates maps template id to face index, and rejects leftover bytes', () => {
    expect([
      ...parseNpcTemplates(
        templatesFile([
          [695, 4],
          [7, 0],
        ]),
      ),
    ]).toEqual([
      [695, 4],
      [7, 0],
    ]);
    expect(() => parseNpcTemplates(templatesFile([[695, 4]], 1))).toThrow(/bytes/);
  });
});

describe('parseNpcFile', () => {
  it('reads every record of a good file', () =>
    expect(parseNpcFile(npcFile([[20002, 695]]))).toEqual({
      npcs: [{ id: 20002, templateId: 695 }],
      complete: true,
    }));

  it('keeps records before a truncated one and reports it', () => {
    const good = npcFile([
      [1, 2],
      [3, 4],
    ]);
    const { npcs, complete } = parseNpcFile(good.subarray(0, good.length - 5));
    expect(npcs).toEqual([{ id: 1, templateId: 2 }]);
    expect(complete).toBe(false);
  });

  it('reports a file whose count promises more records than it holds', () => {
    const good = npcFile([[1, 2]]);
    good.writeUInt16LE(2, 0);
    expect(parseNpcFile(good)).toEqual({ npcs: [{ id: 1, templateId: 2 }], complete: false });
  });

  it('treats an empty file as incomplete', () =>
    expect(parseNpcFile(Buffer.alloc(0))).toEqual({ npcs: [], complete: false }));
});

it.each([
  ['TNPC00000000.tcd', true],
  ['TNPC02bf0000.tcd', true],
  ['TNPC07D00000.tcd', true],
  ['TNPCGlobal.tcd', true],
  ['TNPCTemp.tcd', false],
  ['TNPCPOS.tcd', false],
  ['TNPC02bf00000.tcd', false],
  ['TNPCINFO.tcd', false],
])('isNpcFileName(%s) is %s', (name, ok) => expect(isNpcFileName(name)).toBe(ok));

// TClientCmd.tif frames: int32-length strings, children nested.
type FrameSpec = { id: number; type: number; sprite: number; children?: FrameSpec[] };

function writeFrame(w: ArchiveWriter, { id, type, sprite, children = [] }: FrameSpec) {
  w.u32(id).u8(type);
  for (let i = 0; i < 12; i++) w.u32(0);
  w.u32(sprite).u32(0);
  for (let i = 0; i < 5 + 2 + 4; i++) w.u32(0);
  w.u16(0);
  for (let i = 0; i < 17; i++) w.u32(0);
  w.u32(3);
  for (const c of 'tip') w.u8(c.charCodeAt(0));
  w.u32(0); // empty text
  w.u32(children.length);
  for (const child of children) writeFrame(w, child);
}

const NONE = 0xffffffff;
const sprite = (id: number, s: number): FrameSpec => ({ id, type: 0, sprite: s });

describe('parseImageLists', () => {
  it('keeps the largest list per id, walks children, and maps 0xFFFFFFFF to null', () => {
    const w = new ArchiveWriter().u32(2);
    writeFrame(w, { id: ITEM_ICON_LIST, type: 0x0a, sprite: NONE, children: [sprite(1, 100)] });
    writeFrame(w, {
      id: 1,
      type: 0,
      sprite: NONE,
      children: [
        {
          id: ITEM_ICON_LIST,
          type: 0x0a,
          sprite: NONE,
          children: [sprite(1, NONE), sprite(2, 700), sprite(3, 701)],
        },
        { id: ITEM_ICON_LIST, type: 0x01, sprite: NONE, children: [sprite(9, 1)] }, // wrong type
        { id: 55, type: 0x0a, sprite: NONE, children: [sprite(1, 9)] }, // not wanted
      ],
    });
    const lists = parseImageLists(w.toBuffer(), [ITEM_ICON_LIST, FACE_ICON_LIST]);
    expect([...lists]).toEqual([[ITEM_ICON_LIST, [null, 700, 701]]]);
  });

  it('rejects a truncated file', () => {
    const w = new ArchiveWriter().u32(1);
    writeFrame(w, { id: 1, type: 0x0a, sprite: 0 });
    const buf = w.toBuffer();
    expect(() => parseImageLists(buf.subarray(0, buf.length - 3), [1])).toThrow();
  });
});

describe('buildIconLookup', () => {
  const lists = new Map([
    [ITEM_ICON_LIST, [null, 500]],
    [FACE_ICON_LIST, [null, 600]],
  ]);
  it('resolves item to sprite, with null when the visual or index is missing', () => {
    const { itemIcons } = buildIconLookup({
      items: [
        { itemId: 1, visualId: 10 },
        { itemId: 2, visualId: 99 },
        { itemId: 3, visualId: 11 },
      ],
      visuals: new Map([
        [10, 1],
        [11, 0],
      ]),
      templates: new Map(),
      npcs: [],
      lists,
    });
    expect([...itemIcons]).toEqual([
      [1, 500],
      [2, null],
      [3, null],
    ]);
  });

  it('leaves out NPCs with no template or face 0', () => {
    const { npcFaces } = buildIconLookup({
      items: [],
      visuals: new Map(),
      templates: new Map([
        [7, 1],
        [8, 0],
      ]),
      npcs: [
        { id: 1, templateId: 7 },
        { id: 2, templateId: 8 },
        { id: 3, templateId: 9 },
      ],
      lists,
    });
    expect([...npcFaces]).toEqual([[1, 600]]);
  });
});

describe('renderIconsFile', () => {
  const lookup = {
    itemIcons: new Map<number, number | null>([
      [9, 500],
      [3, 501],
      [5, null],
    ]),
    npcFaces: new Map([
      [20002, 600],
      [4, 601],
    ]),
  };

  it('collects the sprites in use', () => {
    expect(usedSprites(lookup)).toEqual(new Set([500, 501, 600, 601]));
  });

  it('keeps every item key, and nulls sprites that have no pixels', () => {
    expect(renderIconsFile(lookup, new Set([500, 600]))).toBe(
      `// Generated by src/gm/import-game-icons.ts. Do not edit: rerun the import (see the README).
export const itemIcons: Readonly<Record<number, number | null>> = {
  3: null,
  5: null,
  9: 500,
};
export const npcFaces: Readonly<Record<number, number>> = {
  20002: 600,
};
`,
    );
  });
});
