import { Module } from '@nestjs/common';
import { SqlWalletsRepository, WALLETS_REPOSITORY } from './wallets.repository.js';

// What the portal's games share: the list of an account's wallets they bet from.
@Module({
  providers: [{ provide: WALLETS_REPOSITORY, useClass: SqlWalletsRepository }],
  exports: [WALLETS_REPOSITORY],
})
export class GamesModule {}
