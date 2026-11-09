import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { parseItems } from './game-icons-import.js';
import { buildMountModel, parseMonsters, parseMountChart, parseResourceIndex, parseVisualMeshes, type ReadResource } from './mount-models-import.js';

// npm run import:models -w apps/api, with GAME_TCD_DIR in .env set to the client's Tcd folder.
// Rewrites the GLB files in apps/web/public/mount-models from the game client.

// Runs from apps/api, like main.ts, and the single .env lives at the repo root.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

async function main(): Promise<void> {
  const folder = process.env.GAME_TCD_DIR;
  if (!folder) throw new Error('Set GAME_TCD_DIR in .env to the Tcd folder of the game client');
  const clientRoot = path.dirname(path.resolve(folder));
  const indexFile = (name: string) => readFile(path.join(clientRoot, 'Index', name)).then(parseResourceIndex);

  const [pets, monsters, items, visuals, objects, meshes, textures] = await Promise.all([
    readFile(path.join(folder, 'TMount.tcd')).then(parseMountChart),
    readFile(path.join(folder, 'TMon.tcd')).then(parseMonsters),
    readFile(path.join(folder, 'TItem.tcd')).then(parseItems),
    readFile(path.join(folder, 'TItemVisual.tcd')).then(parseVisualMeshes),
    indexFile('TClientO.IDX'),
    indexFile('TClientM.IDX'),
    indexFile('0_TClientS.IDX'),
  ]);

  const files = new Map<string, Buffer>();
  const read: ReadResource = ({ file }) => {
    let data = files.get(file);
    if (!data) {
      data = readFileSync(path.join(clientRoot, 'Data', ...file.split(/[\\/]/)));
      files.set(file, data);
    }
    return data;
  };
  const sources = { monsters, itemVisuals: new Map(items.map((item) => [item.itemId, item.visualId])), visuals, objects, meshes, textures, read };

  const models = new Map<number, Buffer>();
  for (const { petId, monsterId } of pets) {
    try {
      models.set(petId, buildMountModel(monsterId, sources));
    } catch (error) {
      console.warn(`Warning: mount ${petId} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Everything parsed: only now touch the output.
  const outputDir = path.resolve(process.cwd(), '../web/public/mount-models');
  await mkdir(outputDir, { recursive: true });
  for (const [petId, glb] of models) await writeFile(path.join(outputDir, `${petId}.glb`), glb);
  const keep = new Set([...models.keys()].map((petId) => `${petId}.glb`));
  let removed = 0;
  for (const name of await readdir(outputDir)) {
    if (name.toLowerCase().endsWith('.glb') && !keep.has(name)) {
      await unlink(path.join(outputDir, name));
      removed += 1;
    }
  }

  const totalBytes = [...models.values()].reduce((sum, glb) => sum + glb.length, 0);
  console.log(`Mounts in the client: ${pets.length}`);
  console.log(`Models written: ${models.size} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Models removed: ${removed}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
