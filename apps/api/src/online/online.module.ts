import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GmModule } from '../gm/gm.module.js';
import { OnlineController } from './online.controller.js';

@Module({
  imports: [AuthModule, GmModule],
  controllers: [OnlineController],
})
export class OnlineModule {}
