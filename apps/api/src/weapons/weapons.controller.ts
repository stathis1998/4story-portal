import { Controller, Get, Header, NotFoundException, Param, Query, ServiceUnavailableException, StreamableFile, UseGuards } from '@nestjs/common';
import { type WeaponEffectsData, type WeaponSearch, type WeaponSearchResult, weaponSearchSchema } from '@4story-portal/shared';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { WeaponCatalog, WeaponsUnavailableError } from './weapon-catalog.js';

const CACHE_FOR_A_DAY = 'private, max-age=86400';
const itemIdSchema = z.coerce.number().int().min(1).max(65535);

/** The number in "123.png" or "123.glb", or null. */
const fileId = (file: string, extension: string) => {
  const match = new RegExp(`^(\\d{1,10})\\.${extension}$`).exec(file);
  return match ? Number(match[1]) : null;
};

function available<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof WeaponsUnavailableError) throw new ServiceUnavailableException('Weapon previews are not available');
    throw error;
  }
}

@Controller()
@UseGuards(SessionGuard)
export class WeaponsController {
  constructor(private readonly catalog: WeaponCatalog) {}

  @Get('weapon-effects')
  effects(): WeaponEffectsData {
    return available(() => this.catalog.effects());
  }

  @Get('weapon-effects/weapons')
  search(@Query(new ZodValidationPipe(weaponSearchSchema)) query: WeaponSearch): WeaponSearchResult[] {
    return available(() => this.catalog.search(query.q, query.kind));
  }

  @Get('weapon-effects/weapons/:itemId')
  weapon(@Param('itemId', new ZodValidationPipe(itemIdSchema)) itemId: number): WeaponSearchResult {
    const weapon = available(() => this.catalog.describe(itemId));
    if (!weapon) throw new NotFoundException('Weapon not found');
    return weapon;
  }

  @Get('weapon-effects/textures/:file')
  @Header('Cache-Control', CACHE_FOR_A_DAY)
  texture(@Param('file') file: string): StreamableFile {
    const id = fileId(file, 'png');
    const png = available(() => (id === null ? null : this.catalog.texture(id)));
    if (!png) throw new NotFoundException('Texture not found');
    return new StreamableFile(png, { type: 'image/png' });
  }

  @Get('weapon-models/:file')
  @Header('Cache-Control', CACHE_FOR_A_DAY)
  model(@Param('file') file: string, @Query('skin') skin?: string): StreamableFile {
    const id = fileId(file, 'glb');
    const skinId = skin && /^\d{1,10}$/.test(skin) ? Number(skin) : undefined;
    const glb = available(() => (id === null ? null : this.catalog.model(id, skinId)));
    if (!glb) throw new NotFoundException('Weapon model not found');
    return new StreamableFile(glb, { type: 'model/gltf-binary' });
  }
}
