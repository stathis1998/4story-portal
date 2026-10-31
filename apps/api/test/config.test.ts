import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';
import { validEnv } from './fixtures.js';

describe('loadConfig', () => {
  it('parses a valid environment', () =>
    expect(loadConfig(validEnv)).toMatchObject({
      db: { port: 1433, globalName: 'TGLOBAL_GSP_TEST' },
      apiPort: 3000,
    }));

  it('names every missing variable', () =>
    expect(() => loadConfig({})).toThrow(/DB_HOST[\s\S]*JWT_SECRET/));

  it.each(['TGLOBAL]; DROP', 'name with space', 'a.b'])('rejects database name %s', (name) =>
    expect(() => loadConfig({ ...validEnv, DB_GLOBAL_NAME: name })).toThrow(/DB_GLOBAL_NAME/));

  it('rejects a short JWT secret', () =>
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/));
});
