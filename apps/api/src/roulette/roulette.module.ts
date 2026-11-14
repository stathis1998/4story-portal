import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GamesModule } from '../games/games.module.js';
import { GmModule } from '../gm/gm.module.js';
import { RouletteController } from './roulette.controller.js';
import { ROULETTE_REPOSITORY, SqlRouletteRepository } from './roulette.repository.js';
import { RouletteService } from './roulette.service.js';

@Module({
  // GmModule for the audit log the GM routes write to; GamesModule for the account's wallets.
  imports: [AuthModule, GmModule, GamesModule],
  controllers: [RouletteController],
  providers: [RouletteService, { provide: ROULETTE_REPOSITORY, useClass: SqlRouletteRepository }],
})
export class RouletteModule {}
