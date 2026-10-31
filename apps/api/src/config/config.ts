import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const databaseName = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/, 'must contain only letters, digits and underscores');

const controlCredential = z
  .string()
  .regex(/^[\x20-\x7E]{1,50}$/, 'must be 1-50 printable ASCII characters');

const envSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_GLOBAL_NAME: databaseName,
  DB_GAME_NAME: databaseName,
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  API_PORT: z.coerce.number().int().positive(),
  GM_USERNAMES: z.string().default(''),
  CONTROL_HOST: z.string().min(1),
  CONTROL_PORT: z.coerce.number().int().positive(),
  CONTROL_USER: controlCredential,
  CONTROL_PASSWORD: controlCredential,
  GM_LOCATIONS_FILE: z.string().min(1),
});

export type AppConfig = {
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    globalName: string;
    gameName: string;
  };
  jwtSecret: string;
  apiPort: number;
  gm: { usernames: string[]; locationsFile: string };
  control: { host: string; port: number; user: string; password: string };
};

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`);
  }

  const e = result.data;
  return {
    db: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      globalName: e.DB_GLOBAL_NAME,
      gameName: e.DB_GAME_NAME,
    },
    jwtSecret: e.JWT_SECRET,
    apiPort: e.API_PORT,
    gm: {
      usernames: e.GM_USERNAMES.split(',')
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name !== ''),
      locationsFile: e.GM_LOCATIONS_FILE,
    },
    control: {
      host: e.CONTROL_HOST,
      port: e.CONTROL_PORT,
      user: e.CONTROL_USER,
      password: e.CONTROL_PASSWORD,
    },
  };
}

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}
