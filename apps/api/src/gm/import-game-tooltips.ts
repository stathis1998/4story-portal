import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
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
} from './game-tooltips-import.js';

// npm run import:tooltips -w apps/api, with GAME_TCD_DIR in .env set to the client's Tcd folder.
// Rewrites game-tooltips.generated.ts from the game client.

// Runs from apps/api, like main.ts, and the single .env lives at the repo root.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

async function main(): Promise<void> {
  const folder = process.env.GAME_TCD_DIR;
  if (!folder) throw new Error('Set GAME_TCD_DIR in .env to the Tcd folder of the game client');
  const chart = (name: string) => readFile(path.join(folder, name));

  const [items, templates, attrs, magics, grades, formulas, levelCosts, strings] = await Promise.all([
    chart('TItem.tcd').then(parseTooltipItems),
    chart('TInfo.tcd').then(parseInfoTemplates),
    chart('TItemAttr.tcd').then(parseItemAttrs),
    chart('TItemMagic.tcd').then(parseItemMagics),
    chart('TItemGrade.tcd').then(parseItemGrades),
    chart('TFormula.tcd').then(parseFormulas),
    chart('TLevel.tcd').then(parseLevelCosts),
    chart('TString.tcd').then(parseStrings),
  ]);
  const charts = buildTooltipCharts({ items, templates, attrs, magics, grades, formulas, levelCosts, strings });

  // Everything parsed: only now touch the output.
  const output = renderTooltipsFile(charts);
  await writeFile(path.resolve(process.cwd(), 'src/gm/game-tooltips.generated.ts'), output);

  console.log(`Equipment: ${Object.keys(charts.items).length} of ${items.length} items`);
  console.log(`Templates: ${Object.keys(charts.templates).length}, unique lines: ${charts.lines.length}`);
  console.log(`File size: ${Math.round(output.length / 1024)} KB`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
