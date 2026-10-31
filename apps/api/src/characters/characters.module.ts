import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CharactersController } from './characters.controller.js';
import { CHARACTERS_REPOSITORY, SqlCharactersRepository } from './characters.repository.js';
import { CharactersService } from './characters.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CharactersController],
  providers: [CharactersService, { provide: CHARACTERS_REPOSITORY, useClass: SqlCharactersRepository }],
})
export class CharactersModule {}
