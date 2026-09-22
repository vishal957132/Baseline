/**
 * "The local data changed" — broadcast to whoever is reading it.
 *
 * Writes go into SQLite and screens read from it, but nothing connected the
 * two: you could save a reading, return to History, and see the list from
 * before. This is the missing wire.
 *
 * Deliberately not a store: the data lives in SQLite, and putting a copy in
 * Redux would give one fact two homes. All that travels here is the news that
 * something moved; each reader re-asks its own question.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let pending: ReturnType<typeof setTimeout> | null = null;

/** Coalescing window. A drain that syncs six ops should cause one reload. */
const COALESCE_MS = 50;

export function notifyDataChanged(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    listeners.forEach(listener => listener());
  }, COALESCE_MS);
}

/** @returns an unsubscribe function, for an effect's cleanup. */
export function subscribeToData(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper — drops every listener and any queued notification. */
export function resetDataListeners(): void {
  listeners.clear();
  if (pending) clearTimeout(pending);
  pending = null;
}
