import { open, type DB } from '@op-engineering/op-sqlite';

import { MIGRATIONS } from './migrations';

let handle: DB | null = null;
let localSeq = 0;

export async function openDatabase(name = 'baseline.db'): Promise<DB> {
  if (handle) return handle;

  const db = open({ name });

  // WAL is what makes a kill mid-write recoverable instead of corrupting.
  await db.execute('PRAGMA journal_mode = WAL');
  await db.execute('PRAGMA synchronous = NORMAL');

  await migrate(db);

  // No index serves MAX(local_seq), so read it once at open and keep it in
  // memory rather than scanning 18k rows on every write.
  const row = await db.execute(
    `SELECT MAX(s) AS n FROM (
       SELECT MAX(local_seq) AS s FROM measurements
       UNION ALL SELECT MAX(local_seq) FROM outbox
     )`,
  );
  localSeq = Number(row.rows[0]?.n ?? 0);

  handle = db;
  return db;
}

export function getDb(): DB {
  if (!handle) throw new Error('Database not open. Call openDatabase() first.');
  return handle;
}

/** Monotonic counter shared by measurements, events and outbox ops. */
export function nextLocalSeq(): number {
  return ++localSeq;
}

async function migrate(db: DB): Promise<void> {
  const result = await db.execute('PRAGMA user_version');
  const current = Number(result.rows[0]?.user_version ?? 0);

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    // Statements and the version bump together, so a kill partway through
    // rolls back and retries next launch instead of half-applying.
    await db.transaction(async tx => {
      for (const statement of m.statements) await tx.execute(statement);
      await tx.execute(`PRAGMA user_version = ${m.version}`);
    });
  }
}
