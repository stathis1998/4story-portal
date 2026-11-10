import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { type AppConfig, CONFIG } from '../config/config.js';
import { clientSourceFromFolder, DiskModelCache, WEAPON_CLIENT_SOURCE, WEAPON_MODEL_CACHE, WeaponCatalog } from './weapon-catalog.js';
import { WeaponsController } from './weapons.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [WeaponsController],
  providers: [
    WeaponCatalog,
    { provide: WEAPON_CLIENT_SOURCE, inject: [CONFIG], useFactory: (config: AppConfig) => clientSourceFromFolder(config.weapons.gameTcdDir) },
    { provide: WEAPON_MODEL_CACHE, inject: [CONFIG], useFactory: (config: AppConfig) => new DiskModelCache(config.weapons.modelCacheDir) },
  ],
})
export class WeaponsModule {}
