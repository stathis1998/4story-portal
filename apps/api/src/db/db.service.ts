import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import sql from 'mssql';
import { CONFIG, type AppConfig } from '../config/config.js';

// Database names are validated by loadConfig (letters, digits, underscores), so bracketing them is safe.
export function tableNames(config: AppConfig) {
  const global = `[${config.db.globalName}].dbo`;
  const game = `[${config.db.gameName}].dbo`;
  return {
    accounts: `${global}.TACCOUNT_PW`,
    userInfo: `${global}.TUSERINFOTABLE`,
    characters: `${game}.TCHARTABLE`,
    currentUsers: `${global}.TCURRENTUSER`,
    serverChart: `${game}.TSVRCHART`,
    channelChart: `${game}.TCHANNELCHART`,
    managerLog: `${global}.OPTool_ManagerLog`,
    portals: `${game}.TPORTALCHART`,
    spawnPositions: `${game}.TSPAWNPOSCHART`,
    npcs: `${game}.TNPCCHART`,
    npcItems: `${game}.TNPCITEMCHART`,
    items: `${game}.TITEMCHART`,
    itemAttrs: `${game}.TITEMATTRCHART`,
    itemMagics: `${game}.TITEMMAGICCHART`,
    levels: `${game}.TLEVELCHART`,
    allCharacters: `${global}.TALLCHARTABLE`,
    sessionLog: `${global}.TLOG`,
    characterItems: `${game}.TITEMTABLE`,
    companions: `${game}.TCOMPANIONTABLE`,
    characterTitles: `${game}.TTITLETABLE`,
    titles: `${game}.TTITLECHART`,
    friends: `${game}.TFRIENDTABLE`,
    guildMembers: `${game}.TGUILDMEMBERTABLE`,
    guilds: `${game}.TGUILDTABLE`,
    duelScores: `${game}.TDUELSCORETABLE`,
    levelFreezes: `${game}.TCHARLEVELFREEZETABLE`,
    characterStats: `${game}.TCHARSTATTABLE`,
    characterCounters: `${game}.TCHARCOUNTERTABLE`,
    upgradeLog: `${game}.TITEMUPGRADELOGTABLE`,
  };
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool: sql.ConnectionPool;
  readonly tables: ReturnType<typeof tableNames>;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.tables = tableNames(config);
    this.pool = new sql.ConnectionPool({
      server: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      options: { encrypt: false, trustServerCertificate: true },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.close();
  }

  async withTransaction<T>(fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
    const tx = new sql.Transaction(this.pool);
    await tx.begin();
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }
}
