import type { ItemTooltip, TooltipLine } from '@4story-portal/shared';
import type { TooltipAttr, TooltipCharts, TooltipItem } from './tooltip-charts.js';

// The game client's item tooltip, line for line. Everything here follows the client source, quirks
// included: CTDetailInfoManager::NewItemInst, TDetailInfo.cpp and CTClientItem in TClientItem.cpp.
// CString comparisons, BYTE and WORD truncation and FLOAT rounding are kept where they change a number.

export type ItemOption = { id: number; value: number };
/** From TITEMMAGICCHART, which the server uses to scale an option's stored value. */
export type OptionRule = { rvType: number; maxValue: number };

export type ItemInstance = {
  itemId: number;
  /** The item's grade, `+N` in game. */
  upgrade: number;
  gem: number;
  sealed: boolean;
  duraMax: number;
  duraCur: number;
  refine: number;
  /** Wall-clock end time held as UTC, null when the item never expires. */
  endsAt: Date | null;
  gradeEffect: number;
  moggItemId: number;
  eld: number;
  wrap: number;
  customTex: number;
  options: ItemOption[];
  /** TITEMCHART.fRevision and fMRevision. */
  revision: [number, number];
};

const COLOR = {
  text: '#F9E9CA',
  normal: '#DBD6CA',
  magic: '#44A9FF',
  rare: '#FFB12A',
  gem: '#FFFF00',
  wrap: '#FF6464',
  mogg: '#FF66FF',
  refines: '#00FF33',
  customCloak: '#0099FF',
};

// TITEM_TYPE in NetCode.h.
const IT_WEAPON = 1;
const IT_DEFENSIVE = 2;
const IT_LONG = 4;
const IT_SHIELD = 6;
const IT_GAMBLE = 13;
const IT_COSTUME = 17;
// TITEM_KIND in NetCode.h.
const IK_BACK = 19;
// MAGIC_TYPE in NetCode.h.
const MTYPE_PAP = 7;
const MTYPE_PDP = 8;
const MTYPE_LAP = 9;
const MTYPE_MDP = 16;
const MTYPE_MAP = 17;

// By TITEM_KIND, in CTClientItem::GetWeaponPowerLevel and GetShieldPowerLevel.
const WEAPON_RATE: Record<number, number> = { 1: 0.75, 2: 0.2, 3: 1, 4: 1, 5: 1.1, 6: 0.8, 7: 1, 8: 0.8, 9: 1 };
const SHIELD_RATE: Record<number, number> = { 11: 0.8, 12: 1, 13: 1.3, 14: 1.3, 15: 1.3, 16: 1.3, 17: 1.3, 18: 1.3 };
// By ES_* slot.
const PART_POWER: Record<number, number> = { 1: 0.3, 3: 0.2, 5: 0.3, 6: 0.25, 7: 0.15, 8: 0.1 };

// Kinds that show a grade effect, wrap, custom cloak and appearance item. Costumes do too, by type.
const EXTRA_KINDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

const OPTION_LEVELS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
const TATTRLEVEL_SEPERATE = 34;
const TATTRLEVEL_LOWUNIT = 3;
const TATTRLEVEL_HIGHUNIT = 2;
const RUNE_DIVIDER = 1_000_000;
const LUNA_DIVIDER = 1000;

const TITLE_TOKENS = ['/ItemNormal', '/ItemGrade', '/ItemMagic', '/ItemSet', '/ItemRare', '/ItemUnique'] as const;
type TitleToken = (typeof TITLE_TOKENS)[number];

// In the client's order: a line is filled by each of these in turn.
const ITEM_TOKENS = [
  '/ItemMinAP',
  '/ItemMaxAP',
  '/ItemAPSec',
  '/ItemDP',
  '/ItemMinMAP',
  '/ItemMaxMAP',
  '/ItemMAPSec',
  '/ItemMDP',
  '/ItemBlock',
  '/GradeLevel /GemStoneLevel',
  '/GemStoneLevel',
  '/DuraMin',
  '/DuraMax',
  '/RefineMin',
  '/RefineMax',
  '/SellPrice',
  '/EndTime',
  '/NeedsLevel',
] as const;
type ItemToken = (typeof ITEM_TOKENS)[number];

const OPTION_BONUS = '/OptionBonus';
const OPTION_LEVEL = '/OptionLevel';
const NO_STATS: TooltipAttr = { grade: 0, minAP: 0, maxAP: 0, dp: 0, minMAP: 0, maxMAP: 0, mdp: 0, block: 0, speed: 0 };

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const replaceAll = (text: string, token: string, value: string) => text.split(token).join(value);
const format = (template: string, value: number) => template.replace('%d', String(value));
/** A C cast to BYTE. x86 turns NaN and infinity into a value whose low byte is 0. */
const toByte = (value: number) => (Number.isFinite(value) ? Math.trunc(value) & 0xff : 0);
const toWord = (value: number) => value & 0xffff;

function serverOptionValue(option: ItemOption, rule: OptionRule, revision: [number, number]): number {
  const rate = Math.fround(rule.rvType ? (revision[rule.rvType - 1] ?? 1) : 1);
  const scaled = toWord(Math.trunc(Math.fround(Math.fround(rate * option.value) * rule.maxValue)));
  return Math.max(Math.floor(scaled / 100), 1);
}

/** std::map order, keyed by option ID, without the entries the server never loads. */
function serverOptions(item: ItemInstance, rules: ReadonlyMap<number, OptionRule>): ItemOption[] {
  const options = new Map<number, number>();
  for (const option of item.options) {
    const rule = rules.get(option.id);
    if (option.id > 0 && rule && !options.has(option.id)) options.set(option.id, serverOptionValue(option, rule, item.revision));
  }
  return [...options].sort(([a], [b]) => a - b).map(([id, value]) => ({ id, value }));
}

function weaponPowerLevel(chart: TooltipItem, stats: TooltipAttr, charts: TooltipCharts): number {
  const rate = WEAPON_RATE[chart.kind] ?? 0;
  if (rate === 0) return 1;
  const levelConst = 1 / Math.log(charts.formulas.first);
  const [rateX, rateY] = charts.formulas.weapon;
  const low = toByte(Math.log((stats.minAP + stats.minMAP) / (rate * rateX)) * levelConst) + 1;
  const high = toByte(Math.log((stats.maxAP + stats.maxMAP) / (rate * rateY)) * levelConst) + 1;
  return toByte(Math.max(Math.floor((low + high) / 2), 1));
}

function shieldPowerLevel(chart: TooltipItem, stats: TooltipAttr, charts: TooltipCharts): number {
  const part = PART_POWER[chart.slot] ?? 0;
  const rate = SHIELD_RATE[chart.kind] ?? 0;
  if (part === 0 || rate === 0) return 1;
  const levelConst = 1 / Math.log(charts.formulas.first);
  const level = Math.log((stats.dp + stats.mdp) / (rate * part * charts.formulas.item)) * levelConst + 1;
  return level < 0 ? 1 : Math.max(toByte(level), 1);
}

function powerLevel(chart: TooltipItem, stats: TooltipAttr, charts: TooltipCharts): number {
  if (chart.type === IT_WEAPON || chart.type === IT_LONG) return weaponPowerLevel(chart, stats, charts);
  if (chart.type === IT_DEFENSIVE || chart.type === IT_SHIELD) return shieldPowerLevel(chart, stats, charts);
  return 1;
}

type Computed = {
  attrId: number;
  /** With main options applied. */
  stats: TooltipAttr;
  hasStats: boolean;
  optionList: { name: string; value: number }[];
  optionLevel: number;
  applied: { ap: boolean; map: boolean; dp: boolean; mdp: boolean; any: boolean };
};

/** CTClientItem::CalcAttrID. The moved attr ID only changes the competence level: the stats stay. */
function compute(item: ItemInstance, chart: TooltipItem, options: ItemOption[], charts: TooltipCharts): Computed {
  let attrId = chart.attr + (charts.gradeSteps[item.upgrade] ?? 0) + item.gem;
  const base = charts.attrs[attrId];
  const result: Computed = {
    attrId,
    stats: { ...(base ?? NO_STATS) },
    hasStats: base !== undefined,
    optionList: [],
    optionLevel: 0,
    applied: { ap: false, map: false, dp: false, mdp: false, any: false },
  };
  if (!base) return result;

  const { stats, applied } = result;
  for (const { id, value } of options) {
    const magic = charts.magics[id];
    if (!magic) continue;
    if (magic.secondary) {
      if (value > 0) result.optionList.push({ name: magic.name, value });
      result.optionLevel = Math.fround(result.optionLevel + Math.fround(value * magic.util));
      continue;
    }
    if (value > 0) applied.any = true;
    if (id === MTYPE_LAP || id === MTYPE_PAP) {
      applied.ap = true;
      stats.minAP = toWord(stats.minAP + value);
      stats.maxAP = toWord(stats.maxAP + value);
    } else if (id === MTYPE_MAP) {
      applied.map = true;
      stats.minMAP = toWord(stats.minMAP + value + 20);
      stats.maxMAP = toWord(stats.maxMAP + value + 20);
    } else if (id === MTYPE_PDP) {
      applied.dp = true;
      stats.dp = toWord(stats.dp + value);
    } else if (id === MTYPE_MDP) {
      applied.mdp = true;
      stats.mdp = toWord(stats.mdp + value);
    }
  }

  if (applied.ap || applied.map || applied.dp || applied.mdp) {
    const level = powerLevel(chart, stats, charts);
    if (level > base.grade) attrId += level - base.grade;
  }
  result.attrId = attrId;
  return result;
}

function money(copper: number, charts: TooltipCharts): string {
  const { rune: runeText, luna: lunaText, cron: cronText } = charts.text;
  const rune = Math.floor(copper / RUNE_DIVIDER);
  const rest = copper % RUNE_DIVIDER;
  const luna = Math.floor(rest / LUNA_DIVIDER);
  const cron = rest % LUNA_DIVIDER;
  let text = '';
  if (rune) text += format(runeText, rune);
  if (luna) text += (rune ? ' ' : '') + format(lunaText, luna);
  // The client only spaces this after silver, so "1 Gold5 bronze" is what it shows.
  if (cron || (!rune && !luna)) text += (luna ? ' ' : '') + format(cronText, cron);
  return text;
}

function remainingTime(endsAt: Date, now: Date, charts: TooltipCharts): string {
  const { remaining, days: daysText, hours: hoursText, minutes: minutesText, expired } = charts.text;
  const seconds = Math.floor((endsAt.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return expired;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  let text = remaining;
  if (days) text += format(daysText, days);
  if (hours) text += ` ${format(hoursText, hours)}`;
  if (minutes && !days) text += ` ${format(minutesText, minutes)}`;
  return text;
}

export function buildItemTooltip(
  item: ItemInstance,
  databaseName: string,
  charts: TooltipCharts,
  rules: ReadonlyMap<number, OptionRule>,
  now: Date,
): ItemTooltip {
  const chart = charts.items[item.itemId];
  if (!chart) {
    return {
      title: { text: databaseName, color: COLOR.text },
      competence: null,
      quality: 'normal',
      lines: [{ text: 'Unknown item', color: COLOR.text }],
    };
  }

  const options = serverOptions(item, rules);
  const computed = compute(item, chart, options, charts);
  const { stats, optionList, applied } = computed;

  const rare = options.length > 2;
  const magic = options.length > 0 && !rare;
  const graded = item.upgrade > 0;
  const normal = !graded && item.gem === 0 && item.moggItemId === 0 && options.length === 0;

  const finalAttr = charts.attrs[computed.attrId];
  const attrLevel = finalAttr ? Math.max(chart.level, finalAttr.grade) : chart.level;
  const attrName = finalAttr ? (charts.text.attrLevels[Math.min(Math.floor((attrLevel - 1) / 10), 12)] ?? '') : '';
  const cost = charts.levelCosts[attrLevel & 0xff];
  const sellPrice =
    cost === undefined ? 0 : Math.floor(Math.trunc(Math.fround(Math.fround(chart.priceRate * cost) + 0.99)) / 4);

  const magicColor = rare ? COLOR.rare : magic ? COLOR.magic : COLOR.normal;
  const qualityColor = graded ? hex(240, toByte(240 - item.upgrade * 10), toByte(240 - item.upgrade * 10)) : magicColor;

  // NewItemInst decides costumes and cloaks first, so those are never drawn as sealed.
  const isCostume = chart.type === IT_COSTUME;
  const isCloak = chart.kind === IK_BACK;
  const isSealed = !isCostume && !isCloak && chart.type !== IT_GAMBLE && item.sealed;
  const usesOptions = !isSealed && (isCostume || isCloak || !normal);
  // Costumes never show the gem count, and it only goes up to 5.
  const gemSuffix = usesOptions && !isCostume && item.gem >= 1 && item.gem <= 5;

  const titleToken: TitleToken = graded
    ? '/ItemGrade'
    : magic
      ? '/ItemMagic'
      : rare
        ? '/ItemRare'
        : normal
          ? '/ItemNormal'
          : '/ItemGrade';

  const lines: TooltipLine[] = [];
  const addLine = (text: string, color: string) => lines.push({ text, color });
  let title: TooltipLine = { text: chart.name, color: COLOR.text };

  const setPlainTitle = (source: string) => {
    let text = replaceAll(source, '/ItemNormal', '');
    text = replaceAll(text, '/GradeName', attrName);
    title = { text, color: COLOR.text };
    if (item.wrap) addLine(charts.text.wrapFooter, COLOR.wrap);
  };

  const setOptionTitle = (source: string) => {
    let text = title.text;
    if (graded) {
      text = replaceAll(source, '/GradeName', attrName);
      text = replaceAll(text, '/Grade', String(item.upgrade));
      for (const token of ['/ItemGrade', '/ItemMagic', '/ItemRare']) text = replaceAll(text, token, '');
    }
    if (EXTRA_KINDS.has(chart.kind) || isCostume) {
      text += charts.text.effects[item.gradeEffect] ?? '';
      if (item.wrap) addLine(charts.text.wrapFooter, COLOR.wrap);
      if (item.customTex) {
        addLine(' ', COLOR.text);
        addLine('Custom Cloak', COLOR.customCloak);
      }
      const mogg = item.moggItemId ? charts.items[item.moggItemId] : undefined;
      if (mogg) {
        addLine(' ', COLOR.text);
        addLine(charts.text.mogg, COLOR.mogg);
        addLine(mogg.name, COLOR.mogg);
      }
    }
    title = { text, color: qualityColor };
    if (isCostume) addLine(`Special Refines : ${item.refine}/4`, COLOR.refines);
  };

  const statValue = (token: ItemToken): string => {
    // Stats come from the base chart entry on plain items and the option-applied copy otherwise.
    const source = usesOptions ? stats : (finalAttr ?? NO_STATS);
    const exists = usesOptions ? computed.hasStats : finalAttr !== undefined;
    const number = (value: number, shown: boolean) => (shown && exists ? String(value) : '');
    const perSecond = (min: number, max: number) => {
      const value = Math.fround(Math.fround((min + max) * 0.5) * Math.fround(source.speed * Math.fround(0.01)));
      return value === 0 ? '' : value.toFixed(2);
    };
    switch (token) {
      case '/ItemMinAP':
        return number(source.minAP, source.minAP !== 0 || source.maxAP !== 0);
      case '/ItemMaxAP':
        return number(source.maxAP, source.minAP !== 0 || source.maxAP !== 0);
      case '/ItemDP':
        return number(source.dp, source.dp !== 0);
      case '/ItemMinMAP':
        return number(source.minMAP, source.minMAP !== 0 || source.maxMAP !== 0);
      case '/ItemMaxMAP':
        return number(source.maxMAP, source.minMAP !== 0 || source.maxMAP !== 0);
      case '/ItemMDP':
        return number(source.mdp, source.mdp !== 0);
      case '/ItemBlock':
        return number(source.block, source.block !== 0);
      case '/ItemAPSec':
        return exists ? perSecond(source.minAP, source.maxAP) : '';
      case '/ItemMAPSec':
        return exists ? perSecond(source.minMAP, source.maxMAP) : '';
      case '/GradeLevel /GemStoneLevel':
        return competenceLevel();
      case '/DuraMin':
        return item.duraCur === 0 && item.duraMax === 0 ? '' : String(item.duraCur);
      case '/DuraMax':
        return item.duraCur === 0 && item.duraMax === 0 ? '' : String(item.duraMax);
      case '/RefineMin':
        return item.refine === 0 && chart.refineMax === 0 ? '' : String(item.refine);
      case '/RefineMax':
        return item.refine === 0 && chart.refineMax === 0 ? '' : String(chart.refineMax);
      case '/SellPrice':
        return exists && sellPrice !== 0 ? money(sellPrice, charts) : '';
      case '/EndTime':
        return item.endsAt ? remainingTime(item.endsAt, now, charts) : '';
      case '/NeedsLevel':
        return String(item.eld > 0 ? chart.level - item.eld : chart.level);
      default:
        return '';
    }
  };

  function competenceLevel(): string {
    if (!usesOptions) {
      if (!finalAttr) return '';
      const view =
        attrLevel < TATTRLEVEL_SEPERATE
          ? attrLevel - ((attrLevel + TATTRLEVEL_LOWUNIT - 1) % TATTRLEVEL_LOWUNIT)
          : attrLevel - (attrLevel % TATTRLEVEL_HIGHUNIT);
      return view === 0 ? '' : String(view);
    }
    if (attrLevel === 0) return '';
    return String(item.gem > 0 ? attrLevel - item.gem : attrLevel);
  }

  const isMagicLine = (line: string) =>
    applied.any &&
    ((applied.ap && line.includes('/ItemMinAP')) ||
      (applied.map && line.includes('/ItemMinMAP')) ||
      (applied.dp && line.includes('/ItemDP')) ||
      (applied.mdp && line.includes('/ItemMDP')));

  const fillStatLine = (source: string, startColor: string) => {
    let line = source;
    let color = startColor;
    let added = false;
    for (const token of ITEM_TOKENS) {
      if (!line.includes(token)) continue;
      let value = statValue(token);
      if (token === '/GradeLevel /GemStoneLevel' && gemSuffix) value += ` +${item.gem}`;
      if (!value) continue;
      if (token === '/GradeLevel /GemStoneLevel' && gemSuffix) color = COLOR.gem;
      else if (token === '/NeedsLevel' && item.eld > 0) color = COLOR.magic;
      line = replaceAll(line, token, value);
      added = true;
    }
    if (added) addLine(line, color);
  };

  const fillOptionLine = (source: string) => {
    for (let index = 0; index < 6; index++) {
      const nameToken = `/OptionName${index + 1}`;
      const option = optionList[index];
      if (!source.includes(nameToken) || !option) continue;
      const line = replaceAll(replaceAll(source, nameToken, option.name), `/OptionData${index + 1}`, `+${option.value}`);
      addLine(line, magicColor);
      return;
    }
    if (source.includes(OPTION_BONUS)) {
      addLine(replaceAll(source, OPTION_BONUS, charts.text.optionTitle), magicColor);
    } else if (source.includes(OPTION_LEVEL)) {
      const level = OPTION_LEVELS[Math.min(Math.floor(Math.trunc(computed.optionLevel) / 10), OPTION_LEVELS.length - 1)];
      addLine(replaceAll(source, OPTION_LEVEL, level), magicColor);
    }
  };

  const template = (charts.templates[chart.info] ?? []).map((index) => charts.lines[index]);
  let inOptions = false;

  for (const source of template) {
    const token = TITLE_TOKENS.find((candidate) => source.includes(candidate));

    if (!usesOptions) {
      if (token) {
        if (token === '/ItemNormal') setPlainTitle(source);
      } else if (!isSealed) {
        if (source.includes('/')) fillStatLine(source, COLOR.text);
        else addLine(source, COLOR.text);
      }
      continue;
    }

    if (token) {
      if (token === titleToken) setOptionTitle(source);
      continue;
    }
    if (source.includes(OPTION_BONUS)) inOptions = true;
    if (inOptions && optionList.length === 0) continue;
    if (!source.includes('/')) addLine(source, COLOR.text);
    else if (inOptions) fillOptionLine(source);
    else fillStatLine(source, isMagicLine(source) ? magicColor : COLOR.text);
  }

  const badgeAttr = chart.attr ? charts.attrs[computed.attrId - (charts.gradeSteps[item.upgrade] ?? 0) - item.gem] : undefined;

  return {
    title,
    competence: badgeAttr && badgeAttr.grade !== 0 ? badgeAttr.grade : null,
    quality: item.wrap ? 'wrap' : graded ? 'grade' : rare ? 'rare' : magic ? 'magic' : 'normal',
    lines,
  };
}
