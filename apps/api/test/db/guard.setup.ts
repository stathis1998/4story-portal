import path from 'node:path';
import dotenv from 'dotenv';

// Shell variables win over .env, so `DB_GLOBAL_NAME=TGLOBAL_GSP npm run test:db` is still refused.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const names = [process.env.DB_GLOBAL_NAME, process.env.DB_GAME_NAME];
if (!names.every((name) => name?.endsWith('_TEST'))) {
  throw new Error('Refusing to run: DB_GLOBAL_NAME and DB_GAME_NAME must end in _TEST');
}
