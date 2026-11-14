/**
 * The items an upgrade uses, by TITEMCHART.wItemID. Tranus, the consumer goods tradesman (NPC 20846),
 * sells all of them for money.
 */
export const UPGRADE_PRICE_ITEMS = {
  apprentice: 8501,
  master: 7602,
  reflection: 7656,
  potion100: 7609,
  potion150: 7678,
  potion200: 7679,
  potion300: 7863,
  survival: 7654,
  medium: 7920,
  greater: 7921,
} as const;

export type UpgradePriceKey = keyof typeof UPGRADE_PRICE_ITEMS;

/** What a vendor charges for each one, in Bronze. 0 for an item the game database does not have. */
export type UpgradePrices = Record<UpgradePriceKey, number>;
