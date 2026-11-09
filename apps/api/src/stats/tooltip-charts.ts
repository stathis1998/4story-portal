// The shape of game-tooltips.generated.ts: the parts of the client's charts a tooltip reads.

export type TooltipItem = {
  name: string;
  type: number;
  kind: number;
  attr: number;
  /** The primary equipment slot, ES_* in NetCode.h. */
  slot: number;
  level: number;
  refineMax: number;
  priceRate: number;
  canGrade: number;
  info: number;
};

export type TooltipAttr = {
  grade: number;
  minAP: number;
  maxAP: number;
  dp: number;
  minMAP: number;
  maxMAP: number;
  mdp: number;
  block: number;
  speed: number;
};

export type TooltipMagic = { name: string; util: number; secondary: boolean };

export type TooltipFormulas = {
  /** FTYPE_ITEMPOWER's X rate. */
  item: number;
  /** FTYPE_WEAPONPOWER's X and Y rates. */
  weapon: [number, number];
  /** FTYPE_1ST's X rate. */
  first: number;
};

export type TooltipText = {
  optionTitle: string;
  attrLevels: string[];
  remaining: string;
  days: string;
  hours: string;
  minutes: string;
  expired: string;
  wrapFooter: string;
  mogg: string;
  rune: string;
  luna: string;
  cron: string;
  /** By TITEMGRADEEFFECT_TYPE, ready to append to a title. */
  effects: Record<number, string>;
};

export type TooltipCharts = {
  /** Every unique template line; templates hold indexes into it, which keeps the file small. */
  lines: string[];
  templates: Record<number, number[]>;
  items: Record<number, TooltipItem>;
  attrs: Record<number, TooltipAttr>;
  magics: Record<number, TooltipMagic>;
  /** Attr ID step by grade. */
  gradeSteps: number[];
  levelCosts: Record<number, number>;
  formulas: TooltipFormulas;
  text: TooltipText;
};
