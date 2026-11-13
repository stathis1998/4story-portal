import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { parseItems } from './game-icons-import.js';
import { buildMountModel, parseCompanionRunes, parseMonsters, parseMountChart, parseResourceIndex, parseVisualMeshes, type ReadResource } from './mount-models-import.js';

// npm run import:models -w apps/api, with GAME_TCD_DIR in .env set to the client's Tcd folder.
// Rewrites the GLB files in apps/web/public/mount-models and pet-models from the game client.

// Runs from apps/api, like main.ts, and the single .env lives at the repo root.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

async function main(): Promise<void> {
  const folder = process.env.GAME_TCD_DIR;
  if (!folder) throw new Error('Set GAME_TCD_DIR in .env to the Tcd folder of the game client');
  const clientRoot = path.dirname(path.resolve(folder));
  const indexFile = (name: string) => readFile(path.join(clientRoot, 'Index', name)).then(parseResourceIndex);

  const [pets, monsters, itemFile, visuals, objects, meshes, textures] = await Promise.all([
    readFile(path.join(folder, 'TMount.tcd')).then(parseMountChart),
    readFile(path.join(folder, 'TMon.tcd')).then(parseMonsters),
    readFile(path.join(folder, 'TItem.tcd')),
    readFile(path.join(folder, 'TItemVisual.tcd')).then(parseVisualMeshes),
    indexFile('TClientO.IDX'),
    indexFile('TClientM.IDX'),
    indexFile('0_TClientS.IDX'),
  ]);

  const items = parseItems(itemFile);
  const runes = parseCompanionRunes(itemFile);

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

  const build = (kind: string, entries: { id: number; monsterId: number }[]) => {
    const models = new Map<number, Buffer>();
    for (const { id, monsterId } of entries) {
      try {
        models.set(id, buildMountModel(monsterId, sources));
      } catch (error) {
        console.warn(`Warning: ${kind} ${id} skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return models;
  };
  // Mounts are named by their client mount id, pets by their monster id, which several runes can share.
  const mounts = build('mount', pets.map(({ petId, monsterId }) => ({ id: petId, monsterId })));
  const petMonsters = [...new Set(runes.map((rune) => rune.monsterId))];
  const companions = build('pet', petMonsters.map((monsterId) => ({ id: monsterId, monsterId })));

  // Everything parsed: only now touch the output.
  await writeModels('Mount', pets.length, mounts, path.resolve(process.cwd(), '../web/public/mount-models'));
  await writeModels('Pet', petMonsters.length, companions, path.resolve(process.cwd(), '../web/public/pet-models'));
}

/** Writes one GLB per model and removes the ones no longer in the client. */
async function writeModels(label: string, inClient: number, models: Map<number, Buffer>, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  for (const [id, glb] of models) await writeFile(path.join(outputDir, `${id}.glb`), glb);
  const keep = new Set([...models.keys()].map((id) => `${id}.glb`));
  let removed = 0;
  for (const name of await readdir(outputDir)) {
    if (name.toLowerCase().endsWith('.glb') && !keep.has(name)) {
      await unlink(path.join(outputDir, name));
      removed += 1;
    }
  }

  const totalBytes = [...models.values()].reduce((sum, glb) => sum + glb.length, 0);
  console.log(`${label}s in the client: ${inClient}`);
  console.log(`${label} models written: ${models.size} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`${label} models removed: ${removed}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
