import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import type { AccountRow, CharacterRow, CombatRow, CompanionRow, GearRow, SessionRow, SocialRow, SoulLotteryRow, SpendingRow, StatRows, TitleRow } from './stats-rules.js';

export interface StatsRepository {
  loadRows(): Promise<StatRows>;
}

export const STATS_REPOSITORY = Symbol('STATS_REPOSITORY');

const INVEN_EQUIP = 254; // NetCode.h
const STORAGE_INVEN = 0;
const TOWNER_CHAR = 0;
// enum CHARCOUNTER in TMapType.h
const COUNTER_MONEY_SPENT = 3;
const COUNTER_SOULLOT_WON = 4;
const COUNTER_SOULLOT_LOST = 5;
const COUNTER_SOULLOT_MONEY_WON = 6;
const COUNTER_SOULLOT_MONEY_CONSOLATION = 7;

// Only ever reads: the portal's own data goes in PortalStore, not the game databases.
@Injectable()
export class SqlStatsRepository implements StatsRepository {
  constructor(private readonly db: DbService) {}

  async loadRows(): Promise<StatRows> {
    const [characters, sessions, gear, companions, titles, titlesTotal, social, combat, spending, soulLottery, accounts] = await Promise.all([
      this.characters(),
      this.sessions(),
      this.gear(),
      this.companions(),
      this.titles(),
      this.titlesTotal(),
      this.social(),
      this.combat(),
      this.spending(),
      this.soulLottery(),
      this.accounts(),
    ]);
    return { characters, sessions, gear, companions, titles, titlesTotal, social, combat, spending, soulLottery, accounts };
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

  private async gear(): Promise<GearRow[]> {
    const { characters, characterItems, items } = this.db.tables;
    const result = await this.db.pool.request().query<GearRow>(
      `SELECT i.dwOwnerID AS charId, i.bItemID AS slot, i.wItemID AS itemId, chart.szNAME AS name, i.bLevel AS upgrade
       FROM ${characterItems} i
       JOIN ${characters} c ON c.dwCharID = i.dwOwnerID AND c.bDelete = 0
       LEFT JOIN ${items} chart ON chart.wItemID = i.wItemID
       WHERE i.bStorageType = ${STORAGE_INVEN} AND i.bOwnerType = ${TOWNER_CHAR} AND i.dwStorageID = ${INVEN_EQUIP}`,
    );
    return result.recordset;
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
