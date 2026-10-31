import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const databaseName = z
  .string()
  .regex(/^[A-Za-z0-9_]+$/, 'must contain only letters, digits and underscores');

const envSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_GLOBAL_NAME: databaseName,
  DB_GAME_NAME: databaseName,
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  API_PORT: z.coerce.number().int().positive(),
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
  };
}

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}
