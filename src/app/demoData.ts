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
 *
 * Deliberately NOT gated on __DEV__. It was, and the effect was that a release
 * build signed in to an account the sign-in screen advertises as "opens
 * straight to seeded history" and showed an empty dashboard — with Import then
 * returning only the three adapter fixtures, which reads as a broken import
 * rather than an absent seed. These are demo accounts in every build, so their
 * data has to exist in every build.
 */

import { getDb } from '../data/db';
import { deviceTzOffsetMs } from '../domain/time';
import { accountFor } from '../features/auth/accounts';
import { seedDatabase, seedSyncFixtures } from '../test/seed';

export async function ensureDemoData(email: string | null): Promise<void> {
  if (!accountFor(email)?.seedHistory) return;

  try {
    const now = Date.now();
    const tz = deviceTzOffsetMs();
    const db = getDb();
    await seedDatabase(db, now, tz);
    await seedSyncFixtures(db, now, tz);
  } catch (error) {
    // Fixtures must never stop the app: an empty dashboard beats a dead
    // launch. Logged as an error, not a warning — swallowing this quietly is
    // how an empty dashboard went unexplained in the first place.
    console.error('Demo data could not be seeded:', error);
  }
}
