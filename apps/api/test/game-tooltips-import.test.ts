import { describe, expect, it } from 'vitest';
import { ITEM_LAYOUT } from '../src/gm/game-icons-import.js';
import {
  buildTooltipCharts,
  parseFormulas,
  parseInfoTemplates,
  parseItemAttrs,
  parseItemGrades,
  parseItemMagics,
  parseLevelCosts,
  parseStrings,
  parseTooltipItems,
  renderTooltipsFile,
  STRING_IDS,
  type TooltipSources,
} from '../src/gm/game-tooltips-import.js';
import { ArchiveWriter } from './archive-writer.js';

function writeItem(w: ArchiveWriter, name: string, set: Record<number, number>) {
  [...ITEM_LAYOUT].forEach((kind, i) => {
    const v = set[i] ?? 0;
    if (kind === 'b') w.u8(v);
    else if (kind === 'w') w.u16(v);
    else if (kind === 'd') w.u32(v);
    else if (kind === 'f') w.f32(v);
    else w.str(name);
  });
}

describe('tooltip chart parsers', () => {
  it('reads the item fields tooltips use, by their position in the record', () => {
    const w = new ArchiveWriter().u16(1);
    writeItem(w, "Warlord's Cloak", { 0: 1602, 1: 2, 2: 19, 3: 21148, 6: 16, 8: 4, 10: 34, 13: 3, 14: 0.5, 25: 1, 38: 1602 });

    expect(parseTooltipItems(w.toBuffer())).toEqual([
      {
        id: 1602,
        name: "Warlord's Cloak",
        type: 2,
        kind: 19,
        attr: 21148,
        slots: 16,
        slot: 4,
        level: 34,
        refineMax: 3,
        priceRate: 0.5,
        canGrade: 1,
        info: 1602,
      },
    ]);
  });

  it('reads line templates by info ID', () => {
    const w = new ArchiveWriter().u16(1).u32(7).u8(2).str('/ItemNormalAxe').str('Level : /NeedsLevel');
    expect(parseInfoTemplates(w.toBuffer())).toEqual(new Map([[7, ['/ItemNormalAxe', 'Level : /NeedsLevel']]]));
  });

  it('reads the 17-byte stat records', () => {
    const w = new ArchiveWriter().u16(1).u16(101).u8(1);
    for (const v of [11, 12, 13, 14, 15, 16]) w.u16(v);
    w.u8(5).u8(120);
    expect(parseItemAttrs(w.toBuffer())).toEqual(
      new Map([[101, { grade: 1, minAP: 11, maxAP: 12, dp: 13, minMAP: 14, maxMAP: 15, mdp: 16, block: 5, speed: 120 }]]),
    );
  });

  it('marks option kind 0 as a secondary option', () => {
    const w = new ArchiveWriter().u16(2).str('Evade').u16(12).u8(0).f32(0.5).u8(1).str('Attack').u16(7).u8(1).f32(2).u8(0);
    expect(parseItemMagics(w.toBuffer())).toEqual(
      new Map([
        [12, { name: 'Evade', util: 0.5, secondary: true }],
        [7, { name: 'Attack', util: 2, secondary: false }],
      ]),
    );
  });

  it('reads grade steps in file order', () => {
    const w = new ArchiveWriter().u16(3).u8(0).u8(0).u8(1).u8(3).u8(2).u8(6);
    expect(parseItemGrades(w.toBuffer())).toEqual([0, 3, 6]);
  });

  it('keeps the three formulas the power level needs', () => {
    const w = new ArchiveWriter().u16(3);
    w.u8(21).u32(0).f32(4).f32(5);
    w.u8(22).u32(0).f32(6).f32(7);
    w.u8(34).u32(0).f32(1.5).f32(9);
    expect(parseFormulas(w.toBuffer())).toEqual({ item: 4, weapon: [6, 7], first: 1.5 });
  });

  it('rejects a formula chart with a needed formula missing', () => {
    expect(() => parseFormulas(new ArchiveWriter().u16(0).toBuffer())).toThrow(/formula/i);
  });

  it('reads level costs and strings', () => {
    const levels = new ArchiveWriter().u16(1).u8(34).u32(900).u32(1).u32(2);
    expect(parseLevelCosts(levels.toBuffer())).toEqual(new Map([[34, 900]]));
    const strings = new ArchiveWriter().u16(1).u16(959).str('[More]');
    expect(parseStrings(strings.toBuffer())).toEqual(new Map([[959, '[More]']]));
  });

  it('fails on leftover bytes, the sign of a changed format', () => {
    expect(() => parseItemGrades(new ArchiveWriter().u16(0).u8(1).toBuffer())).toThrow(/left over/);
  });
});

describe('buildTooltipCharts', () => {
  const allStrings = new Map(
    Object.values(STRING_IDS)
      .flat()
      .map((id) => [id, `text ${id}`] as const),
  );
  const item = (id: number, slots: number, info: number) => ({
    id,
    name: `Item ${id}`,
    type: 2,
    kind: 19,
    attr: 0,
    slots,
    slot: 4,
    level: 1,
    refineMax: 0,
    priceRate: 1,
    canGrade: 0,
    info,
  });
  const sources = (over: Partial<TooltipSources> = {}): TooltipSources => ({
    items: [item(1, 16, 100), item(2, 0, 200), item(3, 16, 300)],
    templates: new Map([
      [100, ['Shared line', 'Only one']],
      [200, ['Not equipment']],
      [300, ['Shared line']],
    ]),
    attrs: new Map(),
    magics: new Map(),
    grades: [0, 3],
    formulas: { item: 1, weapon: [2, 3], first: 1.5 },
    levelCosts: new Map(),
    strings: allStrings,
    ...over,
  });

  it('keeps only items that can be equipped', () => {
    const charts = buildTooltipCharts(sources());
    expect(Object.keys(charts.items)).toEqual(['1', '3']);
    expect(Object.keys(charts.templates)).toEqual(['100', '300']);
  });

  it('stores each unique line once', () => {
    const { lines, templates } = buildTooltipCharts(sources());
    expect(lines.filter((line) => line === 'Shared line')).toHaveLength(1);
    expect(lines).not.toContain('Not equipment');
    expect(templates[100].map((index) => lines[index])).toEqual(['Shared line', 'Only one']);
    expect(templates[300].map((index) => lines[index])).toEqual(['Shared line']);
  });

  it('names effects the way the client adds them to a title', () => {
    const { effects } = buildTooltipCharts(sources()).text;
    expect(effects[1]).toBe(` text ${STRING_IDS.effects[0]}`);
    expect(effects[15]).toBe(' (Gold)');
    expect(effects[39]).toBe(' (Storm Red)');
    // The client has no name for this effect.
    expect(effects[19]).toBeUndefined();
  });

  it('fails when a needed string is missing', () => {
    expect(() => buildTooltipCharts(sources({ strings: new Map() }))).toThrow(/string/i);
  });

  it('renders a file that parses back to the same charts', () => {
    const charts = buildTooltipCharts(sources());
    const body = renderTooltipsFile(charts).split('export const tooltipCharts: TooltipCharts = ')[1].trim().replace(/;$/, '');
    expect(JSON.parse(body)).toEqual(charts);
  });
});
