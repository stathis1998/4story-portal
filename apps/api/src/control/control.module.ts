import { Global, Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config.js';
import { ControlClient } from './control-client.js';

@Global()
@Module({
  providers: [{ provide: ControlClient, useFactory: (c: AppConfig) => new ControlClient(c.control), inject: [CONFIG] }],
  exports: [ControlClient],
})
export class ControlModule {}
