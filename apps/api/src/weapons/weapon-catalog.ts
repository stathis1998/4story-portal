import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { GradeLayer, WeaponEffectsData, WeaponSearchResult } from '@4story-portal/shared';
import { itemIcons } from '../gm/game-icons.generated.js';
import { parseResourceIndex, parseVisualMeshes, type ReadResource, type VisualMesh } from '../gm/mount-models-import.js';
import { buildGradeLayers, buildWeaponModel, parseGradeVisualChart, parseWeaponItems, type WeaponItem } from './weapon-client.js';

/** What the weapon routes need from the game client, read once. */
export type ClientFiles = {
  weapons: WeaponItem[];
  visuals: Map<number, VisualMesh>;
  layers: Record<string, GradeLayer>;
  pngs: Map<number, Buffer>;
  buildModel(item: WeaponItem): Buffer;
};

export const WEAPON_CLIENT_SOURCE = Symbol('WEAPON_CLIENT_SOURCE');
export type WeaponClientSource = () => ClientFiles;

export const WEAPON_MODEL_CACHE = Symbol('WEAPON_MODEL_CACHE');
export interface ModelCache {
  read(itemId: number): Buffer | null;
  write(itemId: number, glb: Buffer): void;
}

/** The game client isn't where GAME_TCD_DIR says, or isn't configured. */
export class WeaponsUnavailableError extends Error {}

/** Built models on disk, so a restart doesn't rebuild them. A failed write only costs a rebuild. */
export class DiskModelCache implements ModelCache {
  constructor(private readonly dir: string) {}

  read(itemId: number): Buffer | null {
    const file = path.join(this.dir, `${itemId}.glb`);
    return existsSync(file) ? readFileSync(file) : null;
  }

  write(itemId: number, glb: Buffer): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(path.join(this.dir, `${itemId}.glb`), glb);
    } catch {
      // The model was still sent; it will be built again next time.
    }
  }
}

export class MemoryModelCache implements ModelCache {
  private readonly models = new Map<number, Buffer>();
  read(itemId: number): Buffer | null {
    return this.models.get(itemId) ?? null;
  }
  write(itemId: number, glb: Buffer): void {
    this.models.set(itemId, glb);
  }
}

/** Reads the client like import-mount-models.ts: charts from `Tcd`, archives through `Index` and `Data` beside it. */
export function clientSourceFromFolder(tcdDir: string | null): WeaponClientSource {
  return () => {
    if (!tcdDir || !existsSync(path.join(tcdDir, 'TItem.tcd'))) throw new WeaponsUnavailableError('GAME_TCD_DIR does not point at the client Tcd folder');
    const root = path.dirname(path.resolve(tcdDir));
    const index = (name: string) => parseResourceIndex(readFileSync(path.join(root, 'Index', name)));
    const files = new Map<string, Buffer>();
    const read: ReadResource = ({ file }) => {
      let data = files.get(file);
      if (!data) {
        data = readFileSync(path.join(root, 'Data', ...file.split(/[\\/]/)));
        files.set(file, data);
      }
      return data;
    };
    const textures = index('0_TClientS.IDX');
    const visuals = parseVisualMeshes(readFileSync(path.join(tcdDir, 'TItemVisual.tcd')));
    const { layers, pngs } = buildGradeLayers(parseGradeVisualChart(readFileSync(path.join(tcdDir, 'TItemGradeVisual.tcd'))), textures, read);
    const sources = { visuals, objects: index('TClientO.IDX'), meshes: index('TClientM.IDX'), textures, read };
    return {
      weapons: parseWeaponItems(readFileSync(path.join(tcdDir, 'TItem.tcd'))),
      visuals,
      layers,
      pngs,
      buildModel: (item) => buildWeaponModel(item, sources),
    };
  };
}

const MAX_RESULTS = 60;
const MIN_SEARCH_LETTERS = 2;

@Injectable()
export class WeaponCatalog {
  private loaded: ClientFiles | null = null;

  constructor(
    @Inject(WEAPON_CLIENT_SOURCE) private readonly source: WeaponClientSource,
    @Inject(WEAPON_MODEL_CACHE) private readonly cache: ModelCache,
  ) {}

  effects(): WeaponEffectsData {
    return { layers: this.files().layers };
  }

  /** By name, by kind, or both. Nothing for neither, so the whole list is never sent. */
  search(q: string | undefined, kind: number | undefined): WeaponSearchResult[] {
    const needle = q?.toLowerCase() ?? '';
    if (needle.length < MIN_SEARCH_LETTERS && kind === undefined) return [];
    const { weapons } = this.files();
    return weapons
      .filter((weapon) => this.hasModel(weapon) && (kind === undefined || weapon.kind === kind) && weapon.name.toLowerCase().includes(needle))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .slice(0, MAX_RESULTS)
      .map(({ itemId, name, kind: weaponKind, level }) => ({ itemId, name, kind: weaponKind, level, icon: itemIcons[itemId] ?? null }));
  }

  /** One weapon with a model, or null. */
  describe(itemId: number): WeaponSearchResult | null {
    const weapon = this.weapon(itemId);
    return weapon && { itemId: weapon.itemId, name: weapon.name, kind: weapon.kind, level: weapon.level, icon: itemIcons[weapon.itemId] ?? null };
  }

  texture(id: number): Buffer | null {
    return this.files().pngs.get(id) ?? null;
  }

  /** The weapon's model, or its skin's when the skin is a weapon with a model too. Null for anything else. */
  model(itemId: number, skinId?: number): Buffer | null {
    const weapon = this.weapon(skinId) ?? this.weapon(itemId);
    if (!weapon) return null;
    const cached = this.cache.read(weapon.itemId);
    if (cached) return cached;
    try {
      const glb = this.files().buildModel(weapon);
      this.cache.write(weapon.itemId, glb);
      return glb;
    } catch (error) {
      if (error instanceof WeaponsUnavailableError) throw error;
      return null;
    }
  }

  private weapon(itemId: number | undefined): WeaponItem | null {
    if (itemId === undefined) return null;
    const weapon = this.files().weapons.find((candidate) => candidate.itemId === itemId);
    return weapon && this.hasModel(weapon) ? weapon : null;
  }

  /** Vajras and multi-vajras have no mesh in the client. */
  private hasModel(weapon: WeaponItem): boolean {
    const visual = this.files().visuals.get(weapon.visualId);
    return Boolean(visual && (visual.objectId || visual.clothKind) && visual.mesh);
  }

  private files(): ClientFiles {
    if (!this.loaded) {
      try {
        this.loaded = this.source();
      } catch (error) {
        throw error instanceof WeaponsUnavailableError ? error : new WeaponsUnavailableError(String(error));
      }
    }
    return this.loaded;
  }
}
