/**
 * Makes sure a signed-in session has something to show.
 *
 * Demo data belongs to a session, not to a launch. Seeding only at startup
 * left a hole: signing out wipes the local tables, so signing back in within
 * the same run landed on an empty dashboard that only filled after a reload.
 *
 * Both seeds are idempotent — the history skips when rows exist, the sync
 * fixtures skip unless the queue and conflicts are both empty — so this is
 * safe to call on every session start.
 *
 * Whether to seed at all is the account's decision: one demo account exists so
 * the empty states can be seen, and seeding it would make them unreachable.
 */

import { getDb } from '../data/db';
import { deviceTzOffsetMs } from '../domain/time';
import { accountFor } from '../features/auth/accounts';
import { seedDatabase, seedSyncFixtures } from '../test/seed';

export async function ensureDemoData(email: string | null): Promise<void> {
  if (!__DEV__) return;
  if (!accountFor(email)?.seedHistory) return;

  try {
    const now = Date.now();
    const tz = deviceTzOffsetMs();
    const db = getDb();
    await seedDatabase(db, now, tz);
    await seedSyncFixtures(db, now, tz);
  } catch (error) {
    // Fixtures must never stop the app. A warning, not a dead launch.
    console.warn('Demo data skipped:', error);
  }
}
