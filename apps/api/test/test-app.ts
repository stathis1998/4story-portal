import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ACCOUNTS_REPOSITORY, type AccountsRepository } from '../src/auth/accounts.repository.js';
import { CHARACTERS_REPOSITORY, type CharactersRepository } from '../src/characters/characters.repository.js';
import { CONFIG, loadConfig } from '../src/config/config.js';
import { ControlClient } from '../src/control/control-client.js';
import { GM_LOCATIONS_STORE, GmLocationsStore } from '../src/gm/gm-locations.store.js';
import { GM_REPOSITORY } from '../src/gm/gm.repository.js';
import { LOGIN_CLEAR_TIMING } from '../src/gm/logins.service.js';
import { VENDORS_REPOSITORY } from '../src/gm/vendors.repository.js';
import { DbService } from '../src/db/db.service.js';
import { STATS_REPOSITORY } from '../src/stats/stats.repository.js';
import { PortalStore } from '../src/store/portal-store.js';
import { MemoryModelCache, type ModelCache, WEAPON_CLIENT_SOURCE, WEAPON_MODEL_CACHE, type WeaponClientSource, WeaponsUnavailableError } from '../src/weapons/weapon-catalog.js';
import {
  FakeAccountsRepository,
  FakeCharactersRepository,
  FakeControlClient,
  FakeGmRepository,
  FakeStatsRepository,
  FakeVendorsRepository,
} from './fakes.js';
import { validEnv } from './fixtures.js';

export type TestAppOverrides = {
  accounts?: AccountsRepository;
  characters?: CharactersRepository;
  control?: FakeControlClient;
  gm?: FakeGmRepository;
  locations?: GmLocationsStore;
  vendors?: FakeVendorsRepository;
  stats?: FakeStatsRepository;
  store?: PortalStore;
  weapons?: { source: WeaponClientSource; cache?: ModelCache };
};

// Tests never read a real game client unless they hand one in.
const noClient: WeaponClientSource = () => {
  throw new WeaponsUnavailableError('no game client in tests');
};

// The real AppModule with the database and control server swapped out, configured exactly like main.ts.
export async function createTestApp(overrides: TestAppOverrides = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(loadConfig(validEnv))
    .overrideProvider(DbService)
    .useValue({})
    .overrideProvider(ACCOUNTS_REPOSITORY)
    .useValue(overrides.accounts ?? new FakeAccountsRepository())
    .overrideProvider(CHARACTERS_REPOSITORY)
    .useValue(overrides.characters ?? new FakeCharactersRepository())
    .overrideProvider(ControlClient)
    .useValue(overrides.control ?? new FakeControlClient())
    .overrideProvider(GM_REPOSITORY)
    .useValue(overrides.gm ?? new FakeGmRepository())
    .overrideProvider(VENDORS_REPOSITORY)
    .useValue(overrides.vendors ?? new FakeVendorsRepository())
    .overrideProvider(GM_LOCATIONS_STORE)
    .useValue(overrides.locations ?? new GmLocationsStore('./data/unused-test-presets.json'))
    .overrideProvider(LOGIN_CLEAR_TIMING)
    .useValue({ pollMs: 1, waitMs: 50 })
    .overrideProvider(STATS_REPOSITORY)
    .useValue(overrides.stats ?? new FakeStatsRepository())
    .overrideProvider(PortalStore)
    .useValue(overrides.store ?? new PortalStore(':memory:'))
    .overrideProvider(WEAPON_CLIENT_SOURCE)
    .useValue(overrides.weapons?.source ?? noClient)
    .overrideProvider(WEAPON_MODEL_CACHE)
    .useValue(overrides.weapons?.cache ?? new MemoryModelCache())
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
