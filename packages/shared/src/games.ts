/** A character's money as the game stores it. 1 Gold = 1000 Silver, 1 Silver = 1000 Bronze (`copper` in code). */
export type Wallet = { gold: number; silver: number; copper: number };

/** A character a player can stake with, and what it holds. */
export type WalletCharacter = {
  id: number;
  name: string;
  level: number;
  className: string;
  online: boolean;
  wallet: Wallet;
};

/** '1 Gold 200 Silver', '2 Gold', '50 Silver', '0 Silver'. Thousands in Gold get a comma: '1,000 Gold'. */
export function silverText(silver: number): string {
  const gold = Math.floor(silver / 1000);
  const rest = silver - gold * 1000;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold.toLocaleString('en-US')} Gold`);
  if (rest > 0 || gold === 0) parts.push(`${rest} Silver`);
  return parts.join(' ');
}

/** What the wallet can stake, in whole Silver. Loose Bronze does not count. */
export const walletSilver = (wallet: Wallet): number => wallet.gold * 1000 + wallet.silver;
