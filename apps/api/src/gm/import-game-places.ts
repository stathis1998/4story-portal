import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from '../config/config.js';
import { DbService } from '../db/db.service.js';
import {
  buildGamePlaces,
  parsePortals,
  parseRegions,
  type PortalSpawn,
  renderGeneratedFile,
} from './game-places-import.js';

// npm run import:places -w apps/api, with GAME_TCD_DIR in .env set to the client's Tcd folder.
// Rewrites game-places.generated.ts from the game client's chart files and the game database.

// Runs from apps/api, like main.ts, and the single .env lives at the repo root.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

async function readHostedData(db: DbService): Promise<{ spawns: PortalSpawn[]; hostedCells: Set<string> }> {
  const { portals, spawnPositions, serverChart, channelChart } = db.tables;
  const spawns = await db.pool.request().query<PortalSpawn>(
    `SELECT p.wPortalID AS portalId, s.wMapID AS mapId, s.fPosX AS x, s.fPosY AS y, s.fPosZ AS z
     FROM ${portals} p
     JOIN ${spawnPositions} s ON s.wID = p.wSpawnID`,
  );
  const cells = await db.pool.request().query<{ mapId: number; unitId: number }>(
    `SELECT DISTINCT s.wMapID AS mapId, s.wUnitID AS unitId
     FROM ${serverChart} s
     JOIN ${channelChart} c
       ON s.bGroup = c.bGroupID AND s.wMapID = c.wMapID AND s.wUnitID = c.wUnitID AND s.bChannel = c.bPhyChannel`,
  );
  return {
    spawns: spawns.recordset,
    hostedCells: new Set(cells.recordset.map((cell) => `${cell.mapId}:${cell.unitId}`)),
  };
}

async function main(): Promise<void> {
  const folder = process.env.GAME_TCD_DIR;
  if (!folder) throw new Error('Set GAME_TCD_DIR in .env to the Tcd folder of the game client');

  const [regions, portals] = await Promise.all([
    readFile(path.join(folder, 'TRegion.tcd')).then(parseRegions),
    readFile(path.join(folder, 'TPortal.tcd')).then(parsePortals),
  ]);

  const db = new DbService(loadConfig(process.env));
  await db.onModuleInit();
  try {
    const { spawns, hostedCells } = await readHostedData(db);
    const places = buildGamePlaces(regions, portals, spawns, hostedCells);
    const output = path.resolve(process.cwd(), 'src/gm/game-places.generated.ts');
    await writeFile(output, renderGeneratedFile(places));
    console.log(
      `Wrote ${Object.keys(places.mapNames).length} map names and ${places.destinations.length} destinations to ${output}`,
    );
  } finally {
    await db.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
