import { Injectable } from '@nestjs/common';
import type { PositionDestination } from '@4story-portal/shared';
import sql from 'mssql';
import { DbService } from '../db/db.service.js';

export type OnlinePlayerRow = {
  charId: number;
  name: string;
  level: number;
  classCode: number;
  world: number;
  channel: number;
  mapId: number;
};

export type AuditEntry = { ip: string; gmId: string; log: string };

export interface GmRepository {
  listOnlinePlayers(): Promise<OnlinePlayerRow[]>;
  listChannels(): Promise<number[]>;
  isLocationHosted(p: PositionDestination): Promise<boolean>;
  writeAudit(e: AuditEntry): Promise<void>;
}

export const GM_REPOSITORY = Symbol('GM_REPOSITORY');

@Injectable()
export class SqlGmRepository implements GmRepository {
  private tx?: sql.Transaction;

  constructor(private readonly db: DbService) {}

  /** Returns a copy whose queries run on tx (used by tests to roll back). */
  withTransaction(tx: sql.Transaction): SqlGmRepository {
    const copy = new SqlGmRepository(this.db);
    copy.tx = tx;
    return copy;
  }

  private request(): sql.Request {
    return this.tx ? new sql.Request(this.tx) : this.db.pool.request();
  }

  async listOnlinePlayers(): Promise<OnlinePlayerRow[]> {
    const { currentUsers, characters } = this.db.tables;
    const result = await this.request().query<OnlinePlayerRow>(
      `SELECT c.dwCharID AS charId, c.szNAME AS name, c.bLevel AS level, c.bClass AS classCode,
              u.bGroupID AS world, u.bChannel AS channel, c.wMapID AS mapId
       FROM ${currentUsers} u
       JOIN ${characters} c ON c.dwCharID = u.dwCharID
       WHERE u.dwCharID <> 0 AND c.bDelete = 0
       ORDER BY c.szNAME`,
    );
    return result.recordset;
  }

  async listChannels(): Promise<number[]> {
    const result = await this.request().query<{ bLogChannel: number }>(
      `SELECT DISTINCT bLogChannel FROM ${this.db.tables.channelChart} ORDER BY 1`,
    );
    return result.recordset.map((row) => row.bLogChannel);
  }

  async isLocationHosted(p: PositionDestination): Promise<boolean> {
    const { serverChart, channelChart } = this.db.tables;
    const unit = Math.floor(p.z / 1024) * 256 + Math.floor(p.x / 1024);
    const result = await this.request()
      .input('world', sql.TinyInt, p.world)
      .input('channel', sql.TinyInt, p.channel)
      .input('map', sql.Int, p.mapId)
      .input('unit', sql.Int, unit)
      .query(
        `SELECT TOP 1 1 AS hosted
         FROM ${serverChart} s
         JOIN ${channelChart} c
           ON s.bGroup = c.bGroupID AND s.wMapID = c.wMapID AND s.wUnitID = c.wUnitID AND s.bChannel = c.bPhyChannel
         WHERE s.bGroup = @world AND s.wMapID = @map AND s.wUnitID = @unit AND c.bLogChannel = @channel`,
      );
    return result.recordset.length > 0;
  }

  async writeAudit(e: AuditEntry): Promise<void> {
    await this.request()
      .input('pIP', sql.VarChar(15), e.ip.replace('::ffff:', '').slice(0, 15))
      .input('pGMID', sql.VarChar(15), e.gmId.slice(0, 15))
      .input('pLog', sql.VarChar(1024), e.log.slice(0, 1024))
      .query(`EXEC ${this.db.tables.managerLog} @pIP = @pIP, @pGMID = @pGMID, @pCommand = 'TELEPORT', @pLog = @pLog`);
  }
}
