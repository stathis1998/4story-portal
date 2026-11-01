import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { COIN_SPRITES } from '@4story-portal/shared';
import dotenv from 'dotenv';
import {
  buildIconLookup,
  FACE_ICON_LIST,
  isNpcFileName,
  ITEM_ICON_LIST,
  parseImageLists,
  parseItems,
  parseItemVisuals,
  parseNpcFile,
  parseNpcTemplates,
  renderIconsFile,
  usedSprites,
} from './game-icons-import.js';
import { extractSprites } from './game-sprites.js';

// npm run import:icons -w apps/api, with GAME_TCD_DIR in .env set to the client's Tcd folder.
// Rewrites game-icons.generated.ts and the PNGs in apps/web/public/game-icons from the game client.

// Runs from apps/api, like main.ts, and the single .env lives at the repo root.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

async function main(): Promise<void> {
  const folder = process.env.GAME_TCD_DIR;
  if (!folder) throw new Error('Set GAME_TCD_DIR in .env to the Tcd folder of the game client');
  const clientRoot = path.dirname(path.resolve(folder));

  const [items, visuals, templates, commandFile, imageIndex, bufferList] = await Promise.all([
    readFile(path.join(folder, 'TItem.tcd')).then(parseItems),
    readFile(path.join(folder, 'TItemVisual.tcd')).then(parseItemVisuals),
    readFile(path.join(folder, 'TNPCTemp.tcd')).then(parseNpcTemplates),
    readFile(path.join(clientRoot, 'TClientCmd.tif')),
    readFile(path.join(clientRoot, 'Index', 'TClientI.IDX')),
    readFile(path.join(clientRoot, 'Index', 'TClientList.LST')),
  ]);

  const lists = parseImageLists(commandFile, [ITEM_ICON_LIST, FACE_ICON_LIST]);
  for (const [name, id] of [['item icon', ITEM_ICON_LIST], ['NPC face', FACE_ICON_LIST]] as const) {
    if (!lists.has(id)) throw new Error(`The ${name} image list ${id} is missing from TClientCmd.tif`);
  }

  // The client reads NPC files in no useful order; sorted names keep the output stable.
  const npcFiles = (await readdir(folder)).filter(isNpcFileName).sort();
  const npcs: { id: number; templateId: number }[] = [];
  let skipped = 0;
  for (const name of npcFiles) {
    const parsed = parseNpcFile(await readFile(path.join(folder, name)));
    npcs.push(...parsed.npcs);
    if (!parsed.complete) {
      skipped += 1;
      console.warn(`Warning: ${name} could not be read completely; kept ${parsed.npcs.length} NPCs`);
    }
  }

  const lookup = buildIconLookup({ items, visuals, templates, npcs, lists });
  // The price coins are not item or face icons, so they are asked for by name.
  const wanted = usedSprites(lookup);
  for (const sprite of Object.values(COIN_SPRITES)) wanted.add(sprite);
  const pngs = extractSprites({
    imageIndex,
    bufferList,
    readData: (relativePath) => readFileSync(path.join(clientRoot, 'Data', ...relativePath.split(/[\\/]/))),
    wanted,
  });
  for (const [coin, sprite] of Object.entries(COIN_SPRITES)) {
    if (!pngs.has(sprite)) throw new Error(`The ${coin} coin sprite ${sprite} is missing from the extraction`);
  }

  // Everything parsed: only now touch the output.
  const generated = path.resolve(process.cwd(), 'src/gm/game-icons.generated.ts');
  const iconsDir = path.resolve(process.cwd(), '../web/public/game-icons');
  await writeFile(generated, renderIconsFile(lookup, new Set(pngs.keys())));
  await mkdir(iconsDir, { recursive: true });
  for (const [sprite, png] of pngs) await writeFile(path.join(iconsDir, `${sprite}.png`), png);
  const keep = new Set([...pngs.keys()].map((sprite) => `${sprite}.png`));
  let removed = 0;
  for (const name of await readdir(iconsDir)) {
    if (name.toLowerCase().endsWith('.png') && !keep.has(name)) {
      await unlink(path.join(iconsDir, name));
      removed += 1;
    }
  }

  const noIcon = [...lookup.itemIcons.values()].filter((sprite) => sprite === null || !pngs.has(sprite)).length;
  console.log(`Items: ${lookup.itemIcons.size}`);
  console.log(`Items with no icon: ${noIcon}`);
  console.log(`NPC faces: ${[...lookup.npcFaces.values()].filter((sprite) => pngs.has(sprite)).length}`);
  console.log(`PNGs written: ${pngs.size}`);
  console.log(`PNGs removed: ${removed}`);
  console.log(`NPC files skipped: ${skipped}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
