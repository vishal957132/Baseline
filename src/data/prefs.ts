/**
 * Local preferences: the cached session and the user's goals.
 *
 * MMKV rather than SQLite, because none of this is a measurement. Goals in
 * particular are settings — changing one never rewrites history, it only
 * changes what progress is measured against (design page 03).
 */

import { createMMKV } from 'react-native-mmkv';

import type { UnitPrefs } from '../domain/units';
import type { MetricId, SourceId } from '../domain/types';

const store = createMMKV();

export interface Session {
  email: string;
  name: string;
  onboarded: boolean;
  signedInAt: number;
}

const SESSION = 'session';
const GOALS = 'goals';
const SOURCES = 'connectedSources';
const METRICS = 'importedMetrics';
const UNITS = 'unitPrefs';

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

/**
 * Remember that onboarding is done.
 *
 * Redux is memory: flipping the flag there gets the user into the app, but the
 * next launch reads the cached session, so the flag has to live there too or
 * onboarding repeats forever.
 */
export function markOnboarded(): void {
  const session = getSession();
  if (session) setSession({ ...session, onboarded: true });
}

export type Goals = Partial<Record<MetricId, number>>;

const DEFAULT_GOALS: Goals = { weight: 70, steps: 10_000, water: 2_500 };

/**
 * The defaults apply to someone who has never set a goal, not to every key for
 * ever after.
 *
 * This used to spread DEFAULT_GOALS under whatever was stored, and the effect
 * was that a goal could not be cleared: JSON.stringify drops undefined keys, so
 * emptying the weight field wrote an object without one, and the read put 70
 * straight back. Nobody met it during onboarding, where goals are only ever
 * being set for the first time; it appeared the moment the screen became
 * reachable again from Settings.
 */
export function getGoals(): Goals {
  const raw = store.getString(GOALS);
  if (!raw) return DEFAULT_GOALS;
  try {
    return JSON.parse(raw) as Goals;
  } catch {
    return DEFAULT_GOALS;
  }
}

/**
 * Merged over what is already stored, so a caller may send one goal without
 * dropping the others — and may clear one by sending it as undefined, which
 * JSON.stringify then omits.
 *
 * The merge belongs here rather than in `getGoals`: on the read side it made
 * a cleared goal spring back to its default on the next read.
 */
export function setGoals(patch: Goals): void {
  store.set(GOALS, JSON.stringify({ ...getGoals(), ...patch }));
}

/**
 * Which health sources are switched on.
 *
 * The caller supplies the default, so this file needs no knowledge of what a
 * provider is — it only stores the answer.
 */
export function getConnectedSources(defaults: SourceId[]): SourceId[] {
  const raw = store.getString(SOURCES);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as SourceId[];
    return Array.isArray(parsed) ? parsed : defaults;
  } catch {
    return defaults;
  }
}

export function setConnectedSources(ids: SourceId[]): void {
  store.set(SOURCES, JSON.stringify(ids));
}

/**
 * Which metrics an import is allowed to bring in.
 *
 * Separate from the connected sources: a source can be on while one of the
 * metrics it offers is off — "read from Apple Health, but not my sleep".
 */
export function getImportedMetrics(defaults: MetricId[]): MetricId[] {
  const raw = store.getString(METRICS);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as MetricId[];
    return Array.isArray(parsed) ? parsed : defaults;
  } catch {
    return defaults;
  }
}

export function setImportedMetrics(ids: MetricId[]): void {
  store.set(METRICS, JSON.stringify(ids));
}

/**
 * Which unit each metric is displayed in.
 *
 * A setting, like the goals: it changes how every stored reading is read back,
 * never what was stored. Empty means "the canonical unit for each metric",
 * which is why an absent key is not an error.
 */
export function getUnitPrefs(): UnitPrefs {
  const raw = store.getString(UNITS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as UnitPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function setUnitPrefs(prefs: UnitPrefs): void {
  store.set(UNITS, JSON.stringify(prefs));
}

/** Everything local to one signed-in person. Used by sign-out. */
export function clearPrefs(): void {
  store.remove(SESSION);
  store.remove(GOALS);
  store.remove(SOURCES);
  store.remove(METRICS);
  store.remove(UNITS);
}
