// Code tables from the game's protocol header (Lib/Own/TProtocol/include/NetCode.h).
const CLASSES = ['Warrior', 'Ranger', 'Archer', 'Wizard', 'Priest', 'Sorcerer'];
const RACES = ['Human', 'Beast', 'Nymph'];
// TCONTRY_D, TCONTRY_C, TCONTRY_B, TCONTRY_N, TCONTRY_PEACE. Names for B and N are provisional.
const COUNTRIES = ['Defugel', 'Craxion', 'Country B', 'Neutral', 'Peace'];

function lookup(table: string[], code: number): string {
  return table[code] ?? `Unknown (${code})`;
}

export const className = (code: number): string => lookup(CLASSES, code);
export const raceName = (code: number): string => lookup(RACES, code);
export const countryName = (code: number): string => lookup(COUNTRIES, code);
