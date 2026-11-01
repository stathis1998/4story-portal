import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Logger, type OnModuleDestroy } from '@nestjs/common';

export class StoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The portal database is not available', { cause });
    this.name = 'StoreUnavailableError';
  }
}

export type BadgeUnlock = { userId: number; badgeId: string; firstSeen: string | null };
export type SettingChange = { key: string; value: string; changedBy: string; changedAt: string };

// Run in order, once each, tracked by PRAGMA user_version. Add new ones to the end.
const MIGRATIONS = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE setting_changes (
     id INTEGER PRIMARY KEY,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     changed_by TEXT NOT NULL,
     changed_at TEXT NOT NULL
   );
   CREATE TABLE badge_unlocks (
     user_id INTEGER NOT NULL,
     badge_id TEXT NOT NULL,
     first_seen TEXT,
     PRIMARY KEY (user_id, badge_id)
   );`,
  // A badge in here has been through its first recording, so anyone holding it from now on gets a date.
  // A file already in use has done that for the original badges.
  `CREATE TABLE badge_baselines (badge_id TEXT PRIMARY KEY);
   WITH original (badge_id) AS (
     VALUES ('level-10'), ('level-25'), ('level-50'), ('level-75'), ('level-90'),
            ('hours-10'), ('hours-50'), ('hours-100'), ('hours-500'),
            ('streak-7'), ('streak-30'), ('night-owl'), ('veteran'),
            ('upgrade-10'), ('upgrade-15'), ('upgrade-20'), ('geared'),
            ('titles-5'), ('titles-10'), ('companion-20'), ('wealth-1000')
   )
   INSERT INTO badge_baselines (badge_id)
   SELECT badge_id FROM original WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'badges_baselined');`,
];

const HIDE_GMS = 'hide_gms';

// The portal's own data, kept out of the game databases. A broken file must not take the stats down
// with it, so reads fall back to defaults and only saving a setting reports a failure.
export class PortalStore implements OnModuleDestroy {
  private readonly logger = new Logger(PortalStore.name);
  private db: DatabaseSync | null = null;

  constructor(file: string) {
    try {
      if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
      this.db = new DatabaseSync(file);
      this.migrate(this.db);
    } catch (error) {
      this.logger.error(`Could not open the portal database ${file}: ${describe(error)}`);
      this.closeQuietly();
    }
  }

  onModuleDestroy(): void {
    this.close();
  }

  close(): void {
    this.closeQuietly();
  }

  hideGms(): boolean {
    return this.read(() => this.setting(HIDE_GMS) === 'true', false);
  }

  setHideGms(value: boolean, changedBy: string): void {
    const db = this.db;
    if (!db) throw new StoreUnavailableError();
    try {
      this.transaction(db, () => {
        this.saveSetting(db, HIDE_GMS, String(value));
        db.prepare('INSERT INTO setting_changes (key, value, changed_by, changed_at) VALUES (?, ?, ?, ?)').run(
          HIDE_GMS,
          String(value),
          changedBy,
          new Date().toISOString(),
        );
      });
    } catch (error) {
      throw new StoreUnavailableError(error);
    }
  }

  settingChanges(): SettingChange[] {
    return this.read(
      () =>
        this.db!.prepare(
          'SELECT key, value, changed_by AS changedBy, changed_at AS changedAt FROM setting_changes ORDER BY id',
        ).all() as SettingChange[],
      [],
    );
  }

  /**
   * Remembers the badges each account holds. Those already held the first time a badge exists get no
   * date, so a newly added badge doesn't look newly earned. `known` is every badge that exists now.
   */
  recordBadges(held: Map<number, string[]>, today: string, known: readonly string[]): void {
    const db = this.db;
    if (!db) return;
    try {
      this.transaction(db, () => {
        const rows = db.prepare('SELECT badge_id AS badgeId FROM badge_baselines').all() as { badgeId: string }[];
        const baselined = new Set(rows.map((row) => row.badgeId));
        const insert = db.prepare('INSERT OR IGNORE INTO badge_unlocks (user_id, badge_id, first_seen) VALUES (?, ?, ?)');
        for (const [userId, badges] of held) {
          for (const badge of badges) insert.run(userId, badge, baselined.has(badge) ? today : null);
        }
        const mark = db.prepare('INSERT OR IGNORE INTO badge_baselines (badge_id) VALUES (?)');
        for (const badge of known) mark.run(badge);
      });
    } catch (error) {
      this.logger.warn(`Could not record badges: ${describe(error)}`);
    }
  }

  badgeUnlocks(): BadgeUnlock[] {
    return this.read(
      () =>
        this.db!.prepare(
          'SELECT user_id AS userId, badge_id AS badgeId, first_seen AS firstSeen FROM badge_unlocks ORDER BY user_id, badge_id',
        ).all() as BadgeUnlock[],
      [],
    );
  }

  private read<T>(query: () => T, fallback: T): T {
    if (!this.db) return fallback;
    try {
      return query();
    } catch (error) {
      this.logger.warn(`Could not read the portal database: ${describe(error)}`);
      return fallback;
    }
  }

  private setting(key: string): string | undefined {
    const row = this.db!.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private saveSetting(db: DatabaseSync, key: string, value: string): void {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
      key,
      value,
    );
  }

  private migrate(db: DatabaseSync): void {
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.transaction(db, () => {
        db.exec(MIGRATIONS[i]);
        db.exec(`PRAGMA user_version = ${i + 1}`);
      });
    }
  }

  private transaction(db: DatabaseSync, work: () => void): void {
    db.exec('BEGIN IMMEDIATE');
    try {
      work();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  private closeQuietly(): void {
    try {
      this.db?.close();
    } catch {
      // Closing is only tidying up: the file is already unusable or finished with.
    }
    this.db = null;
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
