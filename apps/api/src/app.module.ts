import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.js';
import { DbModule } from './db/db.module.js';

@Module({
  imports: [ConfigModule, DbModule],
})
export class AppModule {}
