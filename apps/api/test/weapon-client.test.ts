import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ITEM_LAYOUT } from '../src/gm/game-icons-import.js';
import { readTextureAnimation, textureSwatch } from '../src/gm/mount-models-import.js';
import { buildGradeLayers, buildWeaponModel, ID_PLAYER_HUMAN, parseGradeVisualChart, parseWeaponItems, type WeaponModelSources } from '../src/weapons/weapon-client.js';
import { ArchiveWriter } from './archive-writer.js';
import { ddsFile, meshFile, objectFile, pngOf, readGlb, textureBlock } from './client-fixtures.js';

const gradeChart = (rows: [kind: number, skin: number, texture: number, op: number][]) => {
  const w = new ArchiveWriter().u16(rows.length);
  rows.forEach(([kind, skin, texture, op]) => w.u8(kind).u16(skin).u32(texture).u8(op));
  return w.toBuffer();
};

type ItemFields = { id: number; kind: number; name: string; level: number; canGrade: number; visual: number };

const itemChart = (items: ItemFields[]) => {
  const w = new ArchiveWriter().u16(items.length);
  for (const item of items) {
    const values: Record<number, number> = { 0: item.id, 2: item.kind, 10: item.level, 25: item.canGrade, 40: item.visual };
    [...ITEM_LAYOUT].forEach((kind, i) => {
      const value = values[i] ?? 0;
      if (kind === 'b') w.u8(value);
      else if (kind === 'w') w.u16(value);
      else if (kind === 'd') w.u32(value);
      else if (kind === 'f') w.f32(value);
      else w.str(item.name);
    });
  }
  return w.toBuffer();
};

describe('parseGradeVisualChart', () => {
  it('reads the rows and adds the skins the client adds in code, without overwriting the file', () => {
    const chart = parseGradeVisualChart(gradeChart([
      [1, 3, 1089470, 5],
      [1, 30, 77, 2],
    ]));

    expect(chart.get('1:3')).toEqual({ texture: 1089470, op: 5 });
    expect(chart.get('1:30')).toEqual({ texture: 77, op: 2 });
    expect(chart.get('2:30')).toEqual({ texture: 999233543, op: 6 });
    expect(chart.get('0:35')).toEqual({ texture: 999232553, op: 1 });
  });

  it('copies the missing breaks and missing cases of the client', () => {
    const chart = parseGradeVisualChart(gradeChart([]));

    expect(chart.get('5:37')).toEqual({ texture: 30003, op: 6 });
    expect(chart.get('5:38')).toBeUndefined();
    expect(chart.get('5:44')).toEqual({ texture: 30009, op: 6 });
    expect(chart.get('5:49')).toBeUndefined();
    expect(chart.get('18:58')).toEqual({ texture: 30022, op: 3 });
    expect(chart.get('19:58')).toBeUndefined();
  });

  it('rejects leftover bytes', () => {
    expect(() => parseGradeVisualChart(Buffer.concat([gradeChart([]), Buffer.alloc(1)]))).toThrow(/left over/);
  });
});

describe('readTextureAnimation', () => {
  const read = (file: Buffer) => () => file;

  it('reads the UV keys and the loop length', () => {
    const keys = [
      { tick: 0, u: 0, v: 0, rotation: 0, scaleU: 1, scaleV: 1 },
      { tick: 3000, u: 0, v: 1, rotation: 0.5, scaleU: 1, scaleV: 1 },
    ];
    const file = textureBlock([], ddsFile(), keys, 3000);

    expect(readTextureAnimation(1, new Map([[1, { file: 'T', pos: 0 }]]), read(file))).toEqual({ keys, loopMs: 3000 });
  });

  it('returns null for an unknown texture', () => {
    expect(readTextureAnimation(1, new Map(), read(Buffer.alloc(0)))).toBeNull();
  });
});

describe('textureSwatch', () => {
  it('is the average colour as hex', () => {
    expect(textureSwatch(pngOf(255, [255, 0, 16]))).toBe('#ff0010');
  });
});

describe('buildGradeLayers', () => {
  const textures = new Map([
    [100, { file: 'tex', pos: 0 }],
    [200, { file: 'empty', pos: 0 }],
  ]);
  const files: Record<string, Buffer> = {
    tex: textureBlock([], ddsFile(), [{ tick: 0, u: 0, v: 0, rotation: 0, scaleU: 1, scaleV: 1 }], 5000),
    empty: textureBlock([], Buffer.alloc(0)),
  };
  const read = ({ file }: { file: string }) => files[file];

  it('builds a layer for each weapon kind and skin with a texture, and keeps each texture once', () => {
    const chart = new Map([
      ['1:1', { texture: 100, op: 19 }],
      ['13:1', { texture: 100, op: 19 }],
    ]);

    const { layers, pngs } = buildGradeLayers(chart, textures, read);

    expect(layers['1:1']).toEqual({ texture: 100, op: 19, keys: [{ tick: 0, u: 0, v: 0, rotation: 0, scaleU: 1, scaleV: 1 }], loopMs: 5000, swatch: '#ff0000' });
    expect(layers['13:1']).toBeUndefined();
    expect([...pngs.keys()]).toEqual([100]);
  });

  it('treats a missing texture, an empty one or an unknown op as no layer', () => {
    const chart = new Map([
      ['1:1', { texture: 999, op: 6 }],
      ['1:2', { texture: 200, op: 6 }],
      ['1:3', { texture: 100, op: 7 }],
      ['1:0', { texture: 0, op: 6 }],
    ]);

    expect(buildGradeLayers(chart, textures, read).layers).toEqual({});
  });
});

describe('parseWeaponItems', () => {
  it('keeps only upgradable weapons with a visual, with their names', () => {
    const items = parseWeaponItems(itemChart([
      { id: 7625, kind: 1, name: 'Sword of Dawn', level: 85, canGrade: 1, visual: 4 },
      { id: 8000, kind: 13, name: 'Plate', level: 80, canGrade: 1, visual: 5 },
      { id: 8001, kind: 6, name: 'Plain Bow', level: 10, canGrade: 0, visual: 6 },
      { id: 8002, kind: 6, name: 'No Look', level: 10, canGrade: 1, visual: 0 },
    ]));

    expect(items).toEqual([{ itemId: 7625, name: 'Sword of Dawn', kind: 1, level: 85, visualId: 4 }]);
  });
});

describe('buildWeaponModel', () => {
  const sources = (objectId: number): WeaponModelSources => {
    const files: Record<string, Buffer> = {
      obj: objectFile(),
      mesh: meshFile({ bones: 0 }),
      tex: textureBlock([], deflateSync(ddsFile())),
    };
    return {
      visuals: new Map([
        [4, { objectId, clothKind: 10, cloth: 20, mesh: 30 }],
        [5, { objectId, clothKind: 10, cloth: 20, mesh: 99 }],
      ]),
      objects: new Map([
        [2, { file: 'obj', pos: 0 }],
        [ID_PLAYER_HUMAN, { file: 'obj', pos: 0 }],
      ]),
      meshes: new Map([[40, { file: 'mesh', pos: 0 }]]),
      textures: new Map([[50, { file: 'tex', pos: 0 }]]),
      read: ({ file }) => files[file],
    };
  };

  it('builds the mesh a weapon object visual selects', () => {
    const { json } = readGlb(buildWeaponModel({ visualId: 4 }, sources(2)));
    expect(json.meshes).toHaveLength(1);
    expect(json.images).toHaveLength(1);
  });

  it('looks in the human character object when the visual has no object of its own', () => {
    expect(readGlb(buildWeaponModel({ visualId: 4 }, sources(0))).json.meshes).toHaveLength(1);
  });

  it('refuses a visual whose mesh is not in the object', () => {
    expect(() => buildWeaponModel({ visualId: 5 }, sources(2))).toThrow(/no mesh/);
    expect(() => buildWeaponModel({ visualId: 9 }, sources(2))).toThrow(/no visual/);
  });
});
