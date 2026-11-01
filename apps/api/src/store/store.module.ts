import { Global, Module } from '@nestjs/common';
import { type AppConfig, CONFIG } from '../config/config.js';
import { PortalStore } from './portal-store.js';

@Global()
@Module({
  providers: [{ provide: PortalStore, useFactory: (config: AppConfig) => new PortalStore(config.portalDbFile), inject: [CONFIG] }],
  exports: [PortalStore],
})
export class StoreModule {}
