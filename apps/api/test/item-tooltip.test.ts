import { describe, expect, it } from 'vitest';
import { buildItemTooltip, type ItemInstance, type OptionRule } from '../src/stats/item-tooltip.js';
import type { TooltipAttr, TooltipCharts } from '../src/stats/tooltip-charts.js';

const TEXT = '#F9E9CA';
const NORMAL = '#DBD6CA';
const MAGIC = '#44A9FF';
const RARE = '#FFB12A';
const YELLOW = '#FFFF00';
const WRAP = '#FF6464';
const MOGG = '#FF66FF';

const attr = (over: Partial<TooltipAttr>): TooltipAttr => ({
  grade: 0,
  minAP: 0,
  maxAP: 0,
  dp: 0,
  minMAP: 0,
  maxMAP: 0,
  mdp: 0,
  block: 0,
  speed: 0,
  ...over,
});

const TITLES = (name: string) => [
  `/ItemNormal${name}`,
  `/ItemGrade${name} (+/Grade)`,
  `/ItemMagic${name}`,
  '/ItemSet/SetItemName',
  '/ItemSet/SetName',
  `/ItemRare${name}`,
  '/ItemUnique/UniqueItemName',
];
const OPTIONS = [
  '/OptionBonus',
  'Option Level : /OptionLevel',
  '/OptionName1 /OptionData1',
  '/OptionName2 /OptionData2',
  '/OptionName3 /OptionData3',
  '/OptionName4 /OptionData4',
  '/OptionName5 /OptionData5',
  '/OptionName6 /OptionData6',
];

// The values for Warlord's Cloak, item 1602, are the real ones from the client's charts.
const TEMPLATES: Record<number, string[]> = {
  1602: [
    ...TITLES("Warlord's Cloak"),
    ' ',
    'Competence Level : /GradeLevel /GemStoneLevel',
    'Type : Cloak',
    'Level : /NeedsLevel',
    'Damage : /ItemMinAP - /ItemMaxAP',
    'Armour : /ItemDP',
    'Magic Armour : /ItemMDP',
    'Durability : /DuraMin / /DuraMax',
    '/EndTime',
    '/UseTime',
    ' ',
    'A cloak for a warlord.',
    ' ',
    'No sale price.',
    ' ',
    ...OPTIONS,
  ],
  2000: [
    ...TITLES('Axe'),
    'Competence Level : /GradeLevel /GemStoneLevel',
    'Damage : /ItemMinAP - /ItemMaxAP',
    'Per second : /ItemAPSec',
    'Magic Damage : /ItemMinMAP - /ItemMaxMAP',
    'Sell : /SellPrice',
    'Refine : /RefineMin / /RefineMax',
    'A note with /Slash in it.',
    ...OPTIONS,
  ],
  3000: [...TITLES('Dress'), 'Type : Costume'],
};

const charts: TooltipCharts = {
  lines: Object.values(TEMPLATES).flat(),
  templates: {},
  items: {
    1602: { name: "Warlord's Cloak", type: 2, kind: 19, attr: 21148, slot: 4, level: 34, refineMax: 0, priceRate: 0, canGrade: 1, info: 1602 },
    2000: { name: 'Axe', type: 1, kind: 5, attr: 500, slot: 0, level: 10, refineMax: 3, priceRate: 2, canGrade: 1, info: 2000 },
    3000: { name: 'Dress', type: 17, kind: 89, attr: 0, slot: 16, level: 1, refineMax: 0, priceRate: 0, canGrade: 0, info: 3000 },
    4000: { name: 'Seen as', type: 2, kind: 19, attr: 0, slot: 4, level: 1, refineMax: 0, priceRate: 0, canGrade: 0, info: 9999 },
  },
  attrs: {
    21148: attr({ grade: 48, dp: 7, mdp: 7 }),
    21225: attr({ grade: 125, dp: 73, mdp: 73 }),
    500: attr({ grade: 10, minAP: 100, maxAP: 200, speed: 50 }),
    502: attr({ grade: 12, minAP: 120, maxAP: 220, speed: 50 }),
  },
  magics: {
    7: { name: 'Physical Attack', util: 1, secondary: false },
    12: { name: 'Evade', util: 0.1, secondary: true },
    17: { name: 'Magic Attack', util: 1, secondary: false },
    50: { name: 'Life', util: 0.1, secondary: true },
    87: { name: 'Resistance', util: 0.1, secondary: true },
  },
  gradeSteps: Array.from({ length: 25 }, (_, grade) => grade * 3),
  levelCosts: { 10: 5000, 13: 40_000_000 },
  formulas: { item: 1, weapon: [10, 20], first: Math.E ** 0.2 },
  text: {
    optionTitle: '[More]',
    attrLevels: Array.from({ length: 13 }, (_, i) => `Era ${i}`),
    remaining: 'Remaining time:',
    days: '%d Days',
    hours: '%d hours',
    minutes: '%d minutes',
    expired: 'The time has expired.',
    wrapFooter: '(Seal)',
    mogg: 'Transmogrified to:',
    rune: '%d Gold',
    luna: '%d silver',
    cron: '%d bronze',
    effects: { 2: ' (Lava)', 15: ' (Gold)' },
  },
};
for (const [info, template] of Object.entries(TEMPLATES)) {
  charts.templates[Number(info)] = template.map((line) => charts.lines.indexOf(line));
}

const rules = new Map<number, OptionRule>([
  [7, { rvType: 0, maxValue: 100 }],
  [12, { rvType: 0, maxValue: 100 }],
  [17, { rvType: 1, maxValue: 200 }],
  [50, { rvType: 0, maxValue: 100 }],
  [87, { rvType: 0, maxValue: 100 }],
]);

const NOW = new Date('2026-11-09T12:00:00Z');

const item = (over: Partial<ItemInstance> = {}): ItemInstance => ({
  itemId: 1602,
  upgrade: 0,
  gem: 0,
  sealed: false,
  duraMax: 2387,
  duraCur: 2137,
  refine: 0,
  endsAt: null,
  gradeEffect: 0,
  moggItemId: 0,
  eld: 0,
  wrap: 0,
  customTex: 0,
  options: [],
  revision: [1, 1],
  ...over,
});

const build = (over: Partial<ItemInstance> = {}, name = 'From database') => buildItemTooltip(item(over), name, charts, rules, NOW);
const texts = (over: Partial<ItemInstance> = {}) => build(over).lines.map((line) => line.text);
const line = (over: Partial<ItemInstance>, start: string) => build(over).lines.find(({ text }) => text.startsWith(start));

const WARLORD: Partial<ItemInstance> = {
  upgrade: 24,
  gem: 5,
  options: [
    { id: 87, value: 319 },
    { id: 12, value: 319 },
    { id: 50, value: 96 },
  ],
};

describe('buildItemTooltip', () => {
  it("draws the real Warlord's Cloak +24, in the game's line order", () => {
    const tooltip = build(WARLORD);
    expect(tooltip.title).toEqual({ text: "Warlord's Cloak (+24)", color: '#F00000' });
    expect(tooltip.quality).toBe('grade');
    expect(tooltip.competence).toBe(48);
    expect(tooltip.lines).toEqual([
      { text: ' ', color: TEXT },
      { text: 'Competence Level : 120 +5', color: YELLOW },
      { text: 'Type : Cloak', color: TEXT },
      { text: 'Level : 34', color: TEXT },
      { text: 'Armour : 73', color: TEXT },
      { text: 'Magic Armour : 73', color: TEXT },
      { text: 'Durability : 2137 / 2387', color: TEXT },
      { text: ' ', color: TEXT },
      { text: 'A cloak for a warlord.', color: TEXT },
      { text: ' ', color: TEXT },
      { text: 'No sale price.', color: TEXT },
      { text: ' ', color: TEXT },
      { text: '[More]', color: RARE },
      { text: 'Option Level : SS', color: RARE },
      { text: 'Evade +319', color: RARE },
      { text: 'Life +96', color: RARE },
      { text: 'Resistance +319', color: RARE },
    ]);
  });

  describe('option values', () => {
    it('shows the value the server sends, not the stored one', () => {
      // Life's stored 96 at a max value of 50 is 48.
      const local = new Map(rules).set(50, { rvType: 0, maxValue: 50 });
      const tooltip = buildItemTooltip(item({ options: [{ id: 50, value: 96 }] }), 'x', charts, local, NOW);
      expect(tooltip.lines.map(({ text }) => text)).toContain('Life +48');
    });

    it('applies the item revision the option names', () => {
      const local = new Map(rules).set(50, { rvType: 2, maxValue: 100 });
      const tooltip = buildItemTooltip(item({ options: [{ id: 50, value: 10 }], revision: [1, 1.5] }), 'x', charts, local, NOW);
      expect(tooltip.lines.map(({ text }) => text)).toContain('Life +15');
    });

    it('never rounds a value below 1', () => {
      const local = new Map(rules).set(50, { rvType: 0, maxValue: 1 });
      const tooltip = buildItemTooltip(item({ options: [{ id: 50, value: 1 }] }), 'x', charts, local, NOW);
      expect(tooltip.lines.map(({ text }) => text)).toContain('Life +1');
    });

    it('ignores empty option columns and options the server has no rule for', () => {
      expect(build({ options: [{ id: 0, value: 5 }, { id: 99, value: 5 }] }).quality).toBe('normal');
    });
  });

  describe('quality', () => {
    it('is magic with one or two options, in blue', () => {
      const tooltip = build({ options: [{ id: 50, value: 10 }] });
      expect(tooltip.quality).toBe('magic');
      expect(tooltip.title).toEqual({ text: "Warlord's Cloak", color: MAGIC });
    });

    it('is rare with three options, in orange', () => {
      const tooltip = build({ options: [{ id: 50, value: 10 }, { id: 12, value: 10 }, { id: 87, value: 10 }] });
      expect(tooltip.quality).toBe('rare');
      expect(tooltip.title.color).toBe(RARE);
    });

    it('tints the title by grade', () => {
      expect(build({ upgrade: 1 }).title).toEqual({ text: "Warlord's Cloak (+1)", color: '#F0E6E6' });
    });

    it('prefers wrap, then grade, for the border', () => {
      expect(build({ upgrade: 3, wrap: 1 }).quality).toBe('wrap');
      expect(build({ upgrade: 3, options: [{ id: 50, value: 10 }] }).quality).toBe('grade');
    });
  });

  describe('plain items', () => {
    it('use the normal title and the rounded competence level', () => {
      const tooltip = build({ itemId: 2000 });
      expect(tooltip.title).toEqual({ text: 'Axe', color: TEXT });
      expect(tooltip.lines[0]).toEqual({ text: 'Competence Level : 10', color: TEXT });
    });

    it('fill damage, damage per second, sell price and refine', () => {
      expect(texts({ itemId: 2000 })).toEqual(
        expect.arrayContaining(['Damage : 100 - 200', 'Per second : 75.00', 'Sell : 2 silver 500 bronze', 'Refine : 0 / 3']),
      );
    });

    it('drop a line whose only token has no value', () => {
      expect(texts({ itemId: 2000 }).some((text) => text.startsWith('Magic Damage'))).toBe(false);
    });

    it('drop a line with a slash that is no token, as the game does', () => {
      expect(texts({ itemId: 2000 })).not.toContain('A note with /Slash in it.');
    });

    it('drop every option line', () => {
      expect(texts({ itemId: 2000 }).some((text) => text.includes('Option') || text === '[More]')).toBe(false);
    });
  });

  describe('stats with main options', () => {
    it('adds attack options to damage, in the magic colour', () => {
      const tooltip = build({ itemId: 2000, options: [{ id: 7, value: 5 }] });
      expect(tooltip.lines.find(({ text }) => text.startsWith('Damage'))).toEqual({ text: 'Damage : 105 - 205', color: MAGIC });
    });

    it('adds the extra 20 the game gives magic attack', () => {
      // Magic attack doubles at maxValue 200, then gains 20.
      expect(line({ itemId: 2000, options: [{ id: 17, value: 5 }] }, 'Magic Damage')?.text).toBe('Magic Damage : 30 - 30');
    });

    it('leaves main options out of the option list', () => {
      const lines = texts({ itemId: 2000, options: [{ id: 7, value: 5 }] });
      expect(lines.some((text) => text.startsWith('Physical Attack'))).toBe(false);
      expect(lines).not.toContain('[More]');
    });

    it('moves the competence level up when options lift the power level past the grade', () => {
      // Worked by hand from GetWeaponPowerLevel: low 13 and high 12 give power level 12, over the attr grade of 10.
      const tooltip = build({ itemId: 2000, options: [{ id: 7, value: 40 }] });
      expect(tooltip.lines[0].text).toBe('Competence Level : 12');
      expect(tooltip.lines.find(({ text }) => text.startsWith('Damage'))?.text).toBe('Damage : 140 - 240');
    });
  });

  describe('expiry', () => {
    const endsIn = (ms: number) => new Date(NOW.getTime() + ms);
    const HOUR = 3_600_000;

    it('shows days and hours without minutes', () => {
      expect(texts({ endsAt: endsIn(3 * 24 * HOUR + 2 * HOUR + 60_000) })).toContain('Remaining time:3 Days 2 hours');
    });

    it('shows hours and minutes on the last day', () => {
      expect(texts({ endsAt: endsIn(2 * HOUR + 5 * 60_000) })).toContain('Remaining time: 2 hours 5 minutes');
    });

    it('says when it has run out', () => {
      expect(texts({ endsAt: endsIn(-1000) })).toContain('The time has expired.');
    });

    it('adds no line without an end time', () => {
      expect(texts().some((text) => text.startsWith('Remaining') || text.startsWith('/EndTime'))).toBe(false);
    });
  });

  describe('title extras', () => {
    it('appends the grade effect name', () => {
      expect(build({ upgrade: 2, gradeEffect: 2 }).title.text).toBe("Warlord's Cloak (+2) (Lava)");
    });

    it('adds no name for an effect the game does not name', () => {
      expect(build({ upgrade: 2, gradeEffect: 19 }).title.text).toBe("Warlord's Cloak (+2)");
    });

    it('adds the wrap footer in red first', () => {
      expect(build({ upgrade: 1, wrap: 1 }).lines[0]).toEqual({ text: '(Seal)', color: WRAP });
    });

    it('names the appearance item', () => {
      expect(build({ upgrade: 1, moggItemId: 4000 }).lines.slice(0, 3)).toEqual([
        { text: ' ', color: TEXT },
        { text: 'Transmogrified to:', color: MOGG },
        { text: 'Seen as', color: MOGG },
      ]);
    });

    it('marks a custom cloak', () => {
      expect(build({ upgrade: 1, customTex: 3 }).lines.slice(0, 2)).toEqual([
        { text: ' ', color: TEXT },
        { text: 'Custom Cloak', color: '#0099FF' },
      ]);
    });

    it('counts refines on costumes', () => {
      expect(build({ itemId: 3000, refine: 2 }).lines[0]).toEqual({ text: 'Special Refines : 2/4', color: '#00FF33' });
    });
  });

  it('lowers the needed level for a reduced item and turns the line blue', () => {
    expect(line({ eld: 4 }, 'Level')).toEqual({ text: 'Level : 30', color: MAGIC });
  });

  it('shows only the title for a sealed item', () => {
    const tooltip = build({ itemId: 2000, sealed: true });
    expect(tooltip.title.text).toBe('Axe');
    expect(tooltip.lines).toEqual([]);
  });

  it('never draws a cloak as sealed', () => {
    expect(texts({ sealed: true })).toContain('Type : Cloak');
  });

  describe('missing data', () => {
    it('shows the database name for an item the client does not know', () => {
      expect(build({ itemId: 7777 }, 'Odd thing')).toEqual({
        title: { text: 'Odd thing', color: TEXT },
        competence: null,
        quality: 'normal',
        lines: [{ text: 'Unknown item', color: TEXT }],
      });
    });

    it('keeps the name and drops stats for an item with no attr entry', () => {
      const tooltip = build({ itemId: 4000 });
      expect(tooltip.title.text).toBe('Seen as');
      expect(tooltip.competence).toBeNull();
      expect(tooltip.lines).toEqual([]);
    });
  });

  it('has no competence badge for an item with no attr ID', () => {
    expect(build({ itemId: 3000 }).competence).toBeNull();
  });

  it('uses the plain item name for a normal title on an item with options and no grade', () => {
    expect(build({ options: [{ id: 50, value: 10 }] }).title.text).toBe("Warlord's Cloak");
  });

  it('shows gear with no durability without a durability line', () => {
    expect(texts({ duraMax: 0, duraCur: 0 }).some((text) => text.startsWith('Durability'))).toBe(false);
  });

  it('uses the normal colour for the title of a gem-only item', () => {
    expect(build({ gem: 2 }).title).toEqual({ text: "Warlord's Cloak", color: NORMAL });
  });
});
