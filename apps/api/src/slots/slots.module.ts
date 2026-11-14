import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GamesModule } from '../games/games.module.js';
import { GmModule } from '../gm/gm.module.js';
import { SlotsController } from './slots.controller.js';
import { SLOTS_REPOSITORY, SqlSlotsRepository } from './slots.repository.js';
import { SlotsService } from './slots.service.js';

@Module({
  // GmModule for the audit log the GM routes write to; GamesModule for the account's wallets.
  imports: [AuthModule, GmModule, GamesModule],
  controllers: [SlotsController],
  providers: [SlotsService, { provide: SLOTS_REPOSITORY, useClass: SqlSlotsRepository }],
})
export class SlotsModule {}
