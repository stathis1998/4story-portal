import sql from 'mssql';
import { loadConfig } from '../../src/config/config.js';
import { DbService } from '../../src/db/db.service.js';

export async function connectTestDb(): Promise<DbService> {
  const db = new DbService(loadConfig(process.env));
  await db.onModuleInit();
  return db;
}

/** Runs fn inside a transaction that is always rolled back, so the _TEST copy is left unchanged. */
export async function inRolledBackTransaction(db: DbService, fn: (tx: sql.Transaction) => Promise<void>) {
  const tx = new sql.Transaction(db.pool);
  await tx.begin();
  try {
    await fn(tx);
  } finally {
    await tx.rollback();
  }
}
