import type { TooltipAttr, TooltipCharts, TooltipFormulas, TooltipItem, TooltipMagic } from '../stats/tooltip-charts.js';
import { ITEM_LAYOUT, readLayout } from './game-icons-import.js';
import { ArchiveReader } from './game-places-import.js';

// Reads the client charts a tooltip needs (see Lib/Own/TChart/TChart/TChart.cpp). No I/O here:
// import-game-tooltips.ts does that.

export type ParsedItem = TooltipItem & { id: number; slots: number };

export type TooltipSources = {
  items: ParsedItem[];
  templates: Map<number, string[]>;
  attrs: Map<number, TooltipAttr>;
  magics: Map<number, TooltipMagic>;
  grades: number[];
  formulas: TooltipFormulas;
  levelCosts: Map<number, number>;
  strings: Map<number, string>;
};

// FORMULA_TYPE in NetCode.h.
const FTYPE_ITEMPOWER = 21;
const FTYPE_WEAPONPOWER = 22;
const FTYPE_1ST = 34;

// TSTRING positions in TChartType.h. The client numbers them by their order in the enum.
export const STRING_IDS = {
  optionTitle: [959],
  attrLevels: [960, 961, 962, 963, 964, 965, 966, 967, 968, 969, 970, 971, 972],
  remaining: [1560],
  days: [1060],
  hours: [1021],
  minutes: [1022],
  expired: [1087],
  wrapFooter: [1238],
  mogg: [1982],
  rune: [233],
  luna: [236],
  cron: [237],
  // TSTR_SEA to TSTR_MAGMA, which are effects 1 to 9.
  effects: [1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006],
} as const;

// CTClientGame::AddEffectString writes these names into the code. Effects it has no case for get no name.
const NAMED_EFFECTS: Record<number, string> = {
  10: ' (Neon Green)',
  11: ' (Magic Ice)',
  12: ' (Magic Blue)',
  13: ' (Shiny Pink)',
  14: ' (Magic Pink)',
  15: ' (Gold)',
  16: ' (Abyss)',
  17: ' (Curved Pink)',
  18: ' (Rainbow)',
  21: ' (Ruby)',
  22: ' (Coral)',
  23: ' (Ecstasy)',
  24: ' (Emerald)',
  25: ' (Lime)',
  27: ' (Sunrise)',
  28: ' (Underworld)',
  29: ' (Prisma)',
  31: ' (Matrix)',
  32: ' (Orange)',
  33: ' (Galactic)',
  34: ' (Copper)',
  35: ' (Violet)',
  36: ' (Contrast)',
  39: ' (Storm Red)',
};

function readAll<T>(file: Buffer, readRecord: (reader: ArchiveReader) => T): T[] {
  const reader = new ArchiveReader(file);
  const records: T[] = [];
  for (let count = reader.u16(); count > 0; count--) records.push(readRecord(reader));
  reader.assertFinished();
  return records;
}

// The name sits in the middle of the record, and readLayout does not keep strings.
const NAME_FIELD = ITEM_LAYOUT.indexOf('s');

export function parseTooltipItems(file: Buffer): ParsedItem[] {
  return readAll(file, (reader) => {
    const before = readLayout(reader, ITEM_LAYOUT.slice(0, NAME_FIELD));
    const name = reader.string();
    const fields = [...before, 0, ...readLayout(reader, ITEM_LAYOUT.slice(NAME_FIELD + 1))];
    return {
      id: fields[0],
      name,
      type: fields[1],
      kind: fields[2],
      attr: fields[3],
      slots: fields[6],
      slot: fields[8],
      level: fields[10],
      refineMax: fields[13],
      priceRate: fields[14],
      canGrade: fields[25],
      info: fields[38],
    };
  });
}

export function parseInfoTemplates(file: Buffer): Map<number, string[]> {
  return new Map(
    readAll(file, (reader) => {
      const id = reader.u32();
      const lines: string[] = [];
      for (let count = reader.u8(); count > 0; count--) lines.push(reader.string());
      return [id, lines] as const;
    }),
  );
}

export function parseItemAttrs(file: Buffer): Map<number, TooltipAttr> {
  return new Map(
    readAll(file, (reader) => {
      const id = reader.u16();
      const attr: TooltipAttr = {
        grade: reader.u8(),
        minAP: reader.u16(),
        maxAP: reader.u16(),
        dp: reader.u16(),
        minMAP: reader.u16(),
        maxMAP: reader.u16(),
        mdp: reader.u16(),
        block: reader.u8(),
        speed: reader.u8(),
      };
      return [id, attr] as const;
    }),
  );
}

export function parseItemMagics(file: Buffer): Map<number, TooltipMagic> {
  return new Map(
    readAll(file, (reader) => {
      const name = reader.string();
      const id = reader.u16();
      const optionKind = reader.u8();
      const util = reader.f32();
      reader.u8(); // sfx
      return [id, { name, util, secondary: optionKind === 0 }] as const;
    }),
  );
}

export function parseItemGrades(file: Buffer): number[] {
  return readAll(file, (reader) => {
    reader.u8(); // level, the same as the position
    return reader.u8();
  });
}

export function parseFormulas(file: Buffer): TooltipFormulas {
  const rates = new Map(
    readAll(file, (reader) => {
      const id = reader.u8();
      reader.u32(); // init
      return [id, [reader.f32(), reader.f32()] as const] as const;
    }),
  );
  const item = rates.get(FTYPE_ITEMPOWER);
  const weapon = rates.get(FTYPE_WEAPONPOWER);
  const first = rates.get(FTYPE_1ST);
  if (!item || !weapon || !first) throw new Error('TFormula.tcd is missing a formula the power level needs');
  return { item: item[0], weapon: [weapon[0], weapon[1]], first: first[0] };
}

export function parseLevelCosts(file: Buffer): Map<number, number> {
  return new Map(
    readAll(file, (reader) => {
      const level = reader.u8();
      const cost = reader.u32();
      reader.skip(8); // registration and search costs
      return [level, cost] as const;
    }),
  );
}

export function parseStrings(file: Buffer): Map<number, string> {
  return new Map(
    readAll(file, (reader) => {
      const id = reader.u16();
      return [id, reader.string()] as const;
    }),
  );
}

/** Only items that can be equipped, since those are all a character sheet shows. */
export function buildTooltipCharts(sources: TooltipSources): TooltipCharts {
  const text = (id: number) => {
    const value = sources.strings.get(id);
    if (value === undefined) throw new Error(`TString.tcd is missing string ${id}`);
    return value;
  };
  const one = (ids: readonly [number]) => text(ids[0]);

  const lineIndexes = new Map<string, number>();
  const lines: string[] = [];
  const indexOf = (line: string) => {
    let index = lineIndexes.get(line);
    if (index === undefined) {
      index = lines.push(line) - 1;
      lineIndexes.set(line, index);
    }
    return index;
  };

  const items: TooltipCharts['items'] = {};
  const templates: TooltipCharts['templates'] = {};
  for (const { id, slots, ...item } of sources.items) {
    if (slots === 0) continue;
    items[id] = item;
    const template = sources.templates.get(item.info);
    if (template && !templates[item.info]) templates[item.info] = template.map(indexOf);
  }

  const effects: Record<number, string> = { ...NAMED_EFFECTS };
  STRING_IDS.effects.forEach((id, index) => {
    effects[index + 1] = ` ${text(id)}`;
  });

  return {
    lines,
    templates,
    items,
    attrs: Object.fromEntries(sources.attrs),
    magics: Object.fromEntries(sources.magics),
    gradeSteps: sources.grades,
    levelCosts: Object.fromEntries(sources.levelCosts),
    formulas: sources.formulas,
    text: {
      optionTitle: one(STRING_IDS.optionTitle),
      attrLevels: STRING_IDS.attrLevels.map(text),
      remaining: one(STRING_IDS.remaining),
      days: one(STRING_IDS.days),
      hours: one(STRING_IDS.hours),
      minutes: one(STRING_IDS.minutes),
      expired: one(STRING_IDS.expired),
      wrapFooter: one(STRING_IDS.wrapFooter),
      mogg: one(STRING_IDS.mogg),
      rune: one(STRING_IDS.rune),
      luna: one(STRING_IDS.luna),
      cron: one(STRING_IDS.cron),
      effects,
    },
  };
}

export function renderTooltipsFile(charts: TooltipCharts): string {
  return `// Generated by src/gm/import-game-tooltips.ts. Do not edit: rerun the import (see the README).
import type { TooltipCharts } from '../stats/tooltip-charts.js';

export const tooltipCharts: TooltipCharts = ${JSON.stringify(charts)};
`;
}
