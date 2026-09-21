/**
 * Conflict resolution. Pure — no database, no clock, no network.
 *
 * The rule, from design page 10:
 *
 *   "Two imports for the same moment merge silently, newest first. Baseline
 *    only asks when something you typed is in contention. Order comes from the
 *    server sequence where there is one, never from a phone clock."
 *
 * So two tiers:
 *   1. nothing manual in contention → merge silently, newest wins;
 *   2. a manual value in contention → ask, suggesting the newest manual one.
 *
 * And "newest" never means the phone clock. It means the server's sequence,
 * falling back to the local counter for rows the server has not seen — those
 * always sort after rows it has.
 */

import type { SourceId } from '../domain/types';

export interface Candidate {
  id: string;
  /** Groups a create with its later edits, so an edit is not its own rival. */
  lineageId: string;
  value: number;
  source: SourceId;
  /** The server's sequence. Null while the server has not accepted this row. */
  serverSeq: number | null;
  localSeq: number;
  /** Phone clock. Shown in the timeline, never used to order. */
  recordedAt: number;
}

export type Policy = 'ask' | 'prefer-mine';

export interface Resolution {
  /** `auto` resolved itself; `ask` needs the user. */
  outcome: 'auto' | 'ask';
  /** One per lineage, newest first. What the conflict screen lists. */
  candidates: Candidate[];
  /** The auto winner, or the one pre-selected as `Suggested`. */
  winner: Candidate;
}

/**
 * Newest first.
 *
 * A row the server has not accepted is newer than any row it has, because it
 * was written after whatever the server last confirmed.
 */
export function newestFirst(a: Candidate, b: Candidate): number {
  if (a.serverSeq === null && b.serverSeq === null) return b.localSeq - a.localSeq;
  if (a.serverSeq === null) return -1;
  if (b.serverSeq === null) return 1;
  return b.serverSeq - a.serverSeq;
}

/** Collapse a lineage to its latest state — a create and its edit count once. */
function latestPerLineage(candidates: Candidate[]): Candidate[] {
  const byLineage = new Map<string, Candidate>();
  for (const c of candidates) {
    const held = byLineage.get(c.lineageId);
    if (!held || newestFirst(c, held) < 0) byLineage.set(c.lineageId, c);
  }
  return [...byLineage.values()].sort(newestFirst);
}

export function resolve(
  candidates: Candidate[],
  policy: Policy = 'ask',
): Resolution {
  if (candidates.length === 0) {
    throw new Error('resolve() needs at least one candidate');
  }

  const collapsed = latestPerLineage(candidates);
  const manual = collapsed.filter(c => c.source === 'manual');

  // Tier 1: no human-authored value in contention, or nothing to contend with.
  if (collapsed.length === 1 || manual.length === 0) {
    return { outcome: 'auto', candidates: collapsed, winner: collapsed[0] };
  }

  // Tier 2: something typed is in contention. The newest manual value is the
  // suggestion, and the standing preference can accept it without asking.
  const suggested = manual[0];
  return {
    outcome: policy === 'prefer-mine' ? 'auto' : 'ask',
    candidates: collapsed,
    winner: suggested,
  };
}
