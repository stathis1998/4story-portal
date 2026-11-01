import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';
import { validEnv } from './fixtures.js';

describe('loadConfig', () => {
  it('parses a valid environment', () =>
    expect(loadConfig(validEnv)).toMatchObject({
      db: { port: 1433, globalName: 'TGLOBAL_GSP_TEST' },
      apiPort: 3000,
    }));

  it('defaults the portal database file, so an existing .env keeps working', () =>
    expect(loadConfig(validEnv).portalDbFile).toBe('./data/portal.sqlite'));

  it('takes the portal database file from the environment', () =>
    expect(loadConfig({ ...validEnv, PORTAL_DB_FILE: './elsewhere.sqlite' }).portalDbFile).toBe('./elsewhere.sqlite'));

  it('names every missing variable', () =>
    expect(() => loadConfig({})).toThrow(/DB_HOST[\s\S]*JWT_SECRET/));

  it.each(['TGLOBAL]; DROP', 'name with space', 'a.b'])('rejects database name %s', (name) =>
    expect(() => loadConfig({ ...validEnv, DB_GLOBAL_NAME: name })).toThrow(/DB_GLOBAL_NAME/));

  it('rejects a short JWT secret', () =>
    expect(() => loadConfig({ ...validEnv, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/));

  it('normalises GM usernames', () =>
    expect(loadConfig({ ...validEnv, GM_USERNAMES: ' Moose, ,Alice ' }).gm.usernames).toEqual([
      'moose',
      'alice',
    ]));

  it('defaults to no GMs', () => {
    const { GM_USERNAMES: _omitted, ...env } = validEnv;
    expect(loadConfig(env).gm.usernames).toEqual([]);
  });

  it('maps the control server settings', () =>
    expect(loadConfig(validEnv)).toMatchObject({
      gm: { locationsFile: './data/gm-locations.json' },
      control: { host: '127.0.0.1', port: 3616, user: 'portal', password: 'secret' },
    }));

  it('rejects a non-numeric control port', () =>
    expect(() => loadConfig({ ...validEnv, CONTROL_PORT: 'x' })).toThrow(/CONTROL_PORT/));

  it('rejects an over-long control password', () =>
    expect(() => loadConfig({ ...validEnv, CONTROL_PASSWORD: 'a'.repeat(51) })).toThrow(
      /CONTROL_PASSWORD/,
    ));
});
