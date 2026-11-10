import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import {
  type AccountRow,
  type CharacterRow,
  type CombatRow,
  type CompanionRow,
  type GearRow,
  type OptionRuleRow,
  type SessionRow,
  type SocialRow,
  type SoulLotteryRow,
  type SpendingRow,
  type StatRows,
  type TitleRow,
  UPGRADE_DESTROYED,
  UPGRADE_KIND_SCROLL,
  type UpgradeAttemptRow,
  type UpgradeFailureRow,
  type UpgradeLossRow,
} from './stats-rules.js';

export interface StatsRepository {
  loadRows(): Promise<StatRows>;
}

export const STATS_REPOSITORY = Symbol('STATS_REPOSITORY');

const INVEN_EQUIP = 254; // NetCode.h
const STORAGE_INVEN = 0;
const TOWNER_CHAR = 0;
// enum CHARCOUNTER in TMapType.h
const COUNTER_UPGRADE_FAIL = 1;
const COUNTER_MONEY_SPENT = 3;
const COUNTER_SOULLOT_WON = 4;
const COUNTER_SOULLOT_LOST = 5;
const COUNTER_SOULLOT_MONEY_WON = 6;
const COUNTER_SOULLOT_MONEY_CONSOLATION = 7;

/** A row of the equipped-items query. The dwTime columns hold the server's IEV_* extended values. */
export type RawGearRow = {
  charId: number;
  slot: number;
  itemId: number;
  name: string | null;
  upgrade: number;
  gem: number;
  gLevel: number;
  duraMax: number;
  duraCur: number;
  refine: number;
  endsAt: Date | null;
  gradeEffect: number;
  moggItemId: number;
  magic1: number;
  magic2: number;
  magic3: number;
  magic4: number;
  magic5: number;
  magic6: number;
  value1: number;
  value2: number;
  value3: number;
  value4: number;
  value5: number;
  value6: number;
  eld: number;
  wrap: number;
  customTex: number;
  revision: number;
  magicRevision: number;
};

const OPTION_COLUMNS = [1, 2, 3, 4, 5, 6] as const;
/** The game stores "never expires" as this year's zero date. */
const NO_EXPIRY_YEAR = 1900;

export function toGearRow(raw: RawGearRow): GearRow {
  const options = OPTION_COLUMNS.flatMap((n) => {
    const id = raw[`magic${n}`];
    // The columns are signed smallints holding the game's unsigned WORDs.
    return id ? [{ id, value: raw[`value${n}`] & 0xffff }] : [];
  });
  return {
    charId: raw.charId,
    slot: raw.slot,
    name: raw.name,
    itemId: raw.itemId,
    upgrade: raw.upgrade,
    gem: raw.gem,
    sealed: raw.gLevel !== 0,
    duraMax: raw.duraMax,
    duraCur: raw.duraCur,
    refine: raw.refine,
    endsAt: raw.endsAt && raw.endsAt.getUTCFullYear() > NO_EXPIRY_YEAR ? raw.endsAt : null,
    gradeEffect: raw.gradeEffect,
    moggItemId: raw.moggItemId & 0xffff,
    eld: raw.eld,
    wrap: raw.wrap,
    customTex: raw.customTex,
    options,
    revision: [raw.revision, raw.magicRevision],
  };
}

// Only ever reads: the portal's own data goes in PortalStore, not the game databases.
@Injectable()
export class SqlStatsRepository implements StatsRepository {
  constructor(private readonly db: DbService) {}

  async loadRows(): Promise<StatRows> {
    const [
      characters,
      sessions,
      gear,
      optionRules,
      companions,
      titles,
      titlesTotal,
      social,
      combat,
      spending,
      soulLottery,
      upgradeAttempts,
      upgradeLosses,
      upgradeFailures,
      accounts,
    ] = await Promise.all([
      this.characters(),
      this.sessions(),
      this.gear(),
      this.optionRules(),
      this.companions(),
      this.titles(),
      this.titlesTotal(),
      this.social(),
      this.combat(),
      this.spending(),
      this.soulLottery(),
      this.upgradeAttempts(),
      this.upgradeLosses(),
      this.upgradeFailures(),
      this.accounts(),
    ]);
    return {
      characters,
      sessions,
      gear,
      optionRules,
      companions,
      titles,
      titlesTotal,
      social,
      combat,
      spending,
      soulLottery,
      upgradeAttempts,
      upgradeLosses,
      upgradeFailures,
      accounts,
    };
  }

  // Grouped in SQL, so the snapshot stays small however long the log grows.
  private async upgradeAttempts(): Promise<UpgradeAttemptRow[]> {
    const { characters, upgradeLog } = this.db.tables;
    const day = 'CONVERT(char(10), l.dLogDate, 23)';
    const result = await this.db.pool.request().query<UpgradeAttemptRow>(
      `SELECT l.dwCharID AS charId, l.bKind AS kind, l.bLevelBefore AS level, l.bResult AS result, ${day} AS day,
              COUNT(*) AS attempts, SUM(CAST(l.bChance AS int)) AS chanceTotal
       FROM ${upgradeLog} l
       JOIN ${characters} c ON c.dwCharID = l.dwCharID AND c.bDelete = 0
       GROUP BY l.dwCharID, l.bKind, l.bLevelBefore, l.bResult, ${day}`,
    );
    return result.recordset;
  }

  private async upgradeLosses(): Promise<UpgradeLossRow[]> {
    const { characters, upgradeLog, items } = this.db.tables;
    const result = await this.db.pool.request().query<UpgradeLossRow>(
      `SELECT l.dwCharID AS charId, l.wItemID AS itemId, chart.szNAME AS name, l.bLevelBefore AS level, l.dLogDate AS at
       FROM ${upgradeLog} l
       JOIN ${characters} c ON c.dwCharID = l.dwCharID AND c.bDelete = 0
       LEFT JOIN ${items} chart ON chart.wItemID = l.wItemID
       WHERE l.bKind = ${UPGRADE_KIND_SCROLL} AND l.bResult = ${UPGRADE_DESTROYED}`,
    );
    return result.recordset;
  }

  private async upgradeFailures(): Promise<UpgradeFailureRow[]> {
    const { characters, characterCounters } = this.db.tables;
    const result = await this.db.pool.request().query<{ charId: number; failed: string }>(
      `SELECT s.dwCharID AS charId, s.nValue AS failed
       FROM ${characterCounters} s
       JOIN ${characters} c ON c.dwCharID = s.dwCharID AND c.bDelete = 0
       WHERE s.wStatID = ${COUNTER_UPGRADE_FAIL}`,
    );
    // The driver returns bigint as text.
    return result.recordset.map((row) => ({ charId: row.charId, failed: Number(row.failed) }));
  }

  private async soulLottery(): Promise<SoulLotteryRow[]> {
    const { characters, characterCounters } = this.db.tables;
    const total = (statId: number) => `SUM(CASE WHEN s.wStatID = ${statId} THEN s.nValue ELSE 0 END)`;
    const result = await this.db.pool
      .request()
      .query<{ charId: number; won: string; lost: string; copperWon: string; copperConsolation: string }>(
        `SELECT s.dwCharID AS charId,
                ${total(COUNTER_SOULLOT_WON)} AS won,
                ${total(COUNTER_SOULLOT_LOST)} AS lost,
                ${total(COUNTER_SOULLOT_MONEY_WON)} AS copperWon,
                ${total(COUNTER_SOULLOT_MONEY_CONSOLATION)} AS copperConsolation
         FROM ${characterCounters} s
         JOIN ${characters} c ON c.dwCharID = s.dwCharID AND c.bDelete = 0
         WHERE s.wStatID IN (${COUNTER_SOULLOT_WON}, ${COUNTER_SOULLOT_LOST}, ${COUNTER_SOULLOT_MONEY_WON}, ${COUNTER_SOULLOT_MONEY_CONSOLATION})
         GROUP BY s.dwCharID`,
      );
    // The driver returns bigint as text.
    return result.recordset.map((row) => ({
      charId: row.charId,
      won: Number(row.won),
      lost: Number(row.lost),
      copperWon: Number(row.copperWon),
      copperConsolation: Number(row.copperConsolation),
    }));
  }

  private async spending(): Promise<SpendingRow[]> {
    const { characters, characterCounters } = this.db.tables;
    const result = await this.db.pool.request().query<{ charId: number; copper: string }>(
      `SELECT s.dwCharID AS charId, s.nValue AS copper
       FROM ${characterCounters} s
       JOIN ${characters} c ON c.dwCharID = s.dwCharID AND c.bDelete = 0
       WHERE s.wStatID = ${COUNTER_MONEY_SPENT}`,
    );
    // The driver returns bigint as text.
    return result.recordset.map((row) => ({ ...row, copper: Number(row.copper) }));
  }

  private async combat(): Promise<CombatRow[]> {
    const { characters, characterStats } = this.db.tables;
    const result = await this.db.pool.request().query<Omit<CombatRow, 'damageDealt'> & { damageDealt: string }>(
      `SELECT s.dwCharID AS charId, s.dwTotalKills AS kills, s.nDamageDealt AS damageDealt
       FROM ${characterStats} s
       JOIN ${characters} c ON c.dwCharID = s.dwCharID AND c.bDelete = 0`,
    );
    // The driver returns bigint as text.
    return result.recordset.map((row) => ({ ...row, damageDealt: Number(row.damageDealt) }));
  }

  private async characters(): Promise<CharacterRow[]> {
    const { characters, levels, allCharacters } = this.db.tables;
    const result = await this.db.pool.request().query<Omit<CharacterRow, 'banned'> & { banned: number }>(
      `SELECT c.dwCharID AS id, c.dwUserID AS userId, c.szNAME AS name, c.bClass AS classCode, c.bRace AS raceCode,
              c.bCountry AS countryCode, c.bLevel AS level, c.dwEXP AS exp, prev.dwEXP AS levelStartExp,
              cur.dwEXP AS levelEndExp, c.dwGold AS gold, c.dCreateDate AS createdAt,
              CASE WHEN EXISTS (SELECT 1 FROM ${allCharacters} a WHERE a.dwCharID = c.dwCharID AND a.Ban <> 0)
                   THEN 1 ELSE 0 END AS banned
       FROM ${characters} c
       LEFT JOIN ${levels} cur ON cur.bLevel = c.bLevel
       LEFT JOIN ${levels} prev ON prev.bLevel = c.bLevel - 1
       WHERE c.bDelete = 0`,
    );
    return result.recordset.map((row) => ({ ...row, banned: row.banned === 1 }));
  }

  private async sessions(): Promise<SessionRow[]> {
    const { characters, sessionLog } = this.db.tables;
    const result = await this.db.pool.request().query<SessionRow>(
      `SELECT l.dwCharID AS charId, l.timeLOGIN AS login, l.timeLOGOUT AS logout
       FROM ${sessionLog} l
       JOIN ${characters} c ON c.dwCharID = l.dwCharID AND c.bDelete = 0
       WHERE l.timeLOGOUT > l.timeLOGIN`,
    );
    return result.recordset;
  }

  private async optionRules(): Promise<OptionRuleRow[]> {
    const result = await this.db.pool
      .request()
      .query<OptionRuleRow>(`SELECT bMagic AS magic, bRvType AS rvType, wMaxValue AS maxValue FROM ${this.db.tables.itemMagics}`);
    return result.recordset;
  }

  private async gear(): Promise<GearRow[]> {
    const { characters, characterItems, items } = this.db.tables;
    const result = await this.db.pool.request().query<RawGearRow>(
      `SELECT i.dwOwnerID AS charId, i.bItemID AS slot, i.wItemID AS itemId, chart.szNAME AS name, i.bLevel AS upgrade,
              i.bGem AS gem, i.bGLevel AS gLevel, i.dwDuraMax AS duraMax, i.dwDuraCur AS duraCur, i.bRefineCur AS refine,
              i.dEndTime AS endsAt, i.bGradeEffect AS gradeEffect, i.wMoggItemID AS moggItemId,
              i.bMagic1 AS magic1, i.bMagic2 AS magic2, i.bMagic3 AS magic3, i.bMagic4 AS magic4, i.bMagic5 AS magic5, i.bMagic6 AS magic6,
              i.wValue1 AS value1, i.wValue2 AS value2, i.wValue3 AS value3, i.wValue4 AS value4, i.wValue5 AS value5, i.wValue6 AS value6,
              i.dwTime1 AS eld, i.dwTime2 AS wrap, i.dwTime6 AS customTex,
              ISNULL(chart.fRevision, 1) AS revision, ISNULL(chart.fMRevision, 1) AS magicRevision
       FROM ${characterItems} i
       JOIN ${characters} c ON c.dwCharID = i.dwOwnerID AND c.bDelete = 0
       LEFT JOIN ${items} chart ON chart.wItemID = i.wItemID
       WHERE i.bStorageType = ${STORAGE_INVEN} AND i.bOwnerType = ${TOWNER_CHAR} AND i.dwStorageID = ${INVEN_EQUIP}`,
    );
    return result.recordset.map(toGearRow);
  }

  private async companions(): Promise<CompanionRow[]> {
    const { characters, companions } = this.db.tables;
    const result = await this.db.pool.request().query<CompanionRow>(
      `SELECT p.dwCharID AS charId, p.bSlot AS slot, p.strName AS name, p.bLevel AS level
       FROM ${companions} p
       JOIN ${characters} c ON c.dwCharID = p.dwCharID AND c.bDelete = 0`,
    );
    return result.recordset;
  }

  private async titles(): Promise<TitleRow[]> {
    const { characters, characterTitles, titles } = this.db.tables;
    const result = await this.db.pool.request().query<TitleRow>(
      `SELECT t.dwCharID AS charId, t.wTitleID AS titleId, CAST(chart.strTitle AS varchar(200)) AS name
       FROM ${characterTitles} t
       JOIN ${characters} c ON c.dwCharID = t.dwCharID AND c.bDelete = 0
       JOIN ${titles} chart ON chart.wTitleID = t.wTitleID
       WHERE t.wTitleID <> 0`,
    );
    return result.recordset;
  }

  private async titlesTotal(): Promise<number> {
    const result = await this.db.pool
      .request()
      .query<{ total: number }>(`SELECT COUNT(*) AS total FROM ${this.db.tables.titles} WHERE wTitleID <> 0`);
    return result.recordset[0].total;
  }

  private async social(): Promise<SocialRow[]> {
    const { characters, friends, guildMembers, guilds, duelScores } = this.db.tables;
    const result = await this.db.pool.request().query<Omit<SocialRow, 'inGuild' | 'leadsGuild'> & { inGuild: number; leadsGuild: number }>(
      `SELECT c.dwCharID AS charId,
              (SELECT COUNT(*) FROM ${friends} f
               JOIN ${characters} other ON other.dwCharID = f.dwFriendID AND other.bDelete = 0
               WHERE f.dwCharID = c.dwCharID) AS friends,
              CASE WHEN EXISTS (SELECT 1 FROM ${guildMembers} m WHERE m.dwCharID = c.dwCharID) THEN 1 ELSE 0 END AS inGuild,
              CASE WHEN EXISTS (SELECT 1 FROM ${guilds} g WHERE g.dwChief = c.dwCharID) THEN 1 ELSE 0 END AS leadsGuild,
              ISNULL(d.dwWarriorWin + d.dwRangerWin + d.dwArcherWin + d.dwWizardWin + d.dwPriestWin + d.dwSorcererWin, 0) AS duelWins
       FROM ${characters} c
       LEFT JOIN ${duelScores} d ON d.dwCharID = c.dwCharID
       WHERE c.bDelete = 0`,
    );
    return result.recordset.map((row) => ({ ...row, inGuild: row.inGuild === 1, leadsGuild: row.leadsGuild === 1 }));
  }

  private async accounts(): Promise<AccountRow[]> {
    const { accounts, characters } = this.db.tables;
    const result = await this.db.pool.request().query<AccountRow>(
      `SELECT a.dwUserID AS userId, a.szUserID AS username
       FROM ${accounts} a
       WHERE EXISTS (SELECT 1 FROM ${characters} c WHERE c.dwUserID = a.dwUserID AND c.bDelete = 0)`,
    );
    return result.recordset;
  }
}
