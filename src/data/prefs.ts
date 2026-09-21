/**
 * Local preferences: the cached session and the user's goals.
 *
 * MMKV rather than SQLite, because none of this is a measurement. Goals in
 * particular are settings — changing one never rewrites history, it only
 * changes what progress is measured against (design page 03).
 */

import { createMMKV } from 'react-native-mmkv';

import type { MetricId } from '../domain/types';

const store = createMMKV();

export interface Session {
  email: string;
  name: string;
  onboarded: boolean;
  signedInAt: number;
}

const SESSION = 'session';
const GOALS = 'goals';

/** A cached session opens straight to the data — no network needed. */
export function getSession(): Session | null {
  const raw = store.getString(SESSION);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  store.set(SESSION, JSON.stringify(session));
}

export function clearSession(): void {
  store.remove(SESSION);
}

export type Goals = Partial<Record<MetricId, number>>;

const DEFAULT_GOALS: Goals = { weight: 70, steps: 10_000, water: 2_500 };

export function getGoals(): Goals {
  const raw = store.getString(GOALS);
  if (!raw) return DEFAULT_GOALS;
  try {
    return { ...DEFAULT_GOALS, ...(JSON.parse(raw) as Goals) };
  } catch {
    return DEFAULT_GOALS;
  }
}

export function setGoals(goals: Goals): void {
  store.set(GOALS, JSON.stringify(goals));
}

/** Everything local to one signed-in person. Used by sign-out. */
export function clearPrefs(): void {
  store.remove(SESSION);
  store.remove(GOALS);
}
