import { expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';
import { tableNames } from '../src/db/db.service.js';
import { validEnv } from './fixtures.js';

it('builds bracketed three-part table names from the configured databases', () =>
  expect(tableNames(loadConfig(validEnv))).toEqual({
    accounts: '[TGLOBAL_GSP_TEST].dbo.TACCOUNT_PW',
    userInfo: '[TGLOBAL_GSP_TEST].dbo.TUSERINFOTABLE',
    characters: '[TGAME_GSP_TEST].dbo.TCHARTABLE',
    currentUsers: '[TGLOBAL_GSP_TEST].dbo.TCURRENTUSER',
    serverChart: '[TGAME_GSP_TEST].dbo.TSVRCHART',
    channelChart: '[TGAME_GSP_TEST].dbo.TCHANNELCHART',
    managerLog: '[TGLOBAL_GSP_TEST].dbo.OPTool_ManagerLog',
    portals: '[TGAME_GSP_TEST].dbo.TPORTALCHART',
    spawnPositions: '[TGAME_GSP_TEST].dbo.TSPAWNPOSCHART',
    npcs: '[TGAME_GSP_TEST].dbo.TNPCCHART',
    npcItems: '[TGAME_GSP_TEST].dbo.TNPCITEMCHART',
    items: '[TGAME_GSP_TEST].dbo.TITEMCHART',
    itemAttrs: '[TGAME_GSP_TEST].dbo.TITEMATTRCHART',
    levels: '[TGAME_GSP_TEST].dbo.TLEVELCHART',
  }));
