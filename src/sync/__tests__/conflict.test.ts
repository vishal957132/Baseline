import { newestFirst, resolve, type Candidate } from '../conflict';

const make = (p: Partial<Candidate> & { id: string }): Candidate => ({
  lineageId: p.id,
  value: 0,
  source: 'manual',
  serverSeq: null,
  localSeq: 0,
  recordedAt: 0,
  ...p,
});

/**
 * The scenario from design page 10, exactly.
 *
 *   10:01 — you recorded 72.8 kg            (manual, local)
 *   10:02 — Apple Health reported 72.5 kg   (import, local)
 *   10:03 — you corrected it to 72.6 kg     (manual edit of the 10:01 row)
 *   10:04 — the server already had 72.4 kg  (manual, written by your iPad)
 *
 * Four events, but the 10:01 entry and the 10:03 correction are the same
 * record, so they count once. Three candidates, 72.6 suggested.
 */
describe('the 10:01–10:04 scenario', () => {
  const events: Candidate[] = [
    make({ id: 'local-create', lineageId: 'A', value: 72.8, source: 'manual', localSeq: 12 }),
    make({ id: 'health-import', lineageId: 'B', value: 72.5, source: 'apple_health', localSeq: 13 }),
    make({ id: 'local-edit', lineageId: 'A', value: 72.6, source: 'manual', localSeq: 14 }),
    make({ id: 'ipad-row', lineageId: 'C', value: 72.4, source: 'manual', serverSeq: 100 }),
  ];
  const result = resolve(events);

  it('collapses four events into three candidates', () => {
    expect(result.candidates).toHaveLength(3);
  });

  it('keeps the correction, not the original, for the edited lineage', () => {
    const lineageA = result.candidates.filter(c => c.lineageId === 'A');
    expect(lineageA).toHaveLength(1);
    expect(lineageA[0].value).toBe(72.6);
  });

  it('asks, because two typed values are in contention', () => {
    expect(result.outcome).toBe('ask');
  });

  it('suggests 72.6 — the newest thing the user typed', () => {
    expect(result.winner.value).toBe(72.6);
  });

  it('offers exactly the three values from the design', () => {
    expect(result.candidates.map(c => c.value)).toEqual([72.6, 72.5, 72.4]);
  });
});

describe('tier one: nothing typed is in contention', () => {
  it('merges two imports silently, newest first', () => {
    const result = resolve([
      make({ id: 'a', value: 72.5, source: 'apple_health', localSeq: 10 }),
      make({ id: 'b', value: 72.7, source: 'health_connect', localSeq: 11 }),
    ]);
    expect(result.outcome).toBe('auto');
    expect(result.winner.value).toBe(72.7);
  });

  it('resolves a single candidate without asking', () => {
    const result = resolve([make({ id: 'only', value: 72.6 })]);
    expect(result.outcome).toBe('auto');
    expect(result.winner.value).toBe(72.6);
  });

  it('never asks about an import against an import, even with three sources', () => {
    const result = resolve([
      make({ id: 'a', value: 1, source: 'apple_health', serverSeq: 5 }),
      make({ id: 'b', value: 2, source: 'health_connect', serverSeq: 7 }),
      make({ id: 'c', value: 3, source: 'json_feed', serverSeq: 6 }),
    ]);
    expect(result.outcome).toBe('auto');
    expect(result.winner.value).toBe(2); // highest serverSeq
  });
});

describe('the standing preference', () => {
  const contested: Candidate[] = [
    make({ id: 'mine', value: 72.6, source: 'manual', localSeq: 20 }),
    make({ id: 'scale', value: 72.5, source: 'apple_health', localSeq: 21 }),
  ];

  it('asks by default', () => {
    expect(resolve(contested, 'ask').outcome).toBe('ask');
  });

  it('"always prefer what I typed myself" resolves without asking', () => {
    const result = resolve(contested, 'prefer-mine');
    expect(result.outcome).toBe('auto');
    expect(result.winner.value).toBe(72.6);
  });
});

describe('ordering never uses the phone clock', () => {
  it('sorts by server sequence when both sides have one', () => {
    const older = make({ id: 'a', serverSeq: 10, recordedAt: 9_999_999 });
    const newer = make({ id: 'b', serverSeq: 20, recordedAt: 1 });
    expect([older, newer].sort(newestFirst)[0].id).toBe('b');
  });

  it('treats an un-synced row as newer than any synced one', () => {
    const synced = make({ id: 'synced', serverSeq: 9_999 });
    const local = make({ id: 'local', serverSeq: null, localSeq: 1 });
    expect([synced, local].sort(newestFirst)[0].id).toBe('local');
  });

  it('falls back to the local counter when neither is synced', () => {
    const a = make({ id: 'a', localSeq: 1 });
    const b = make({ id: 'b', localSeq: 2 });
    expect([a, b].sort(newestFirst)[0].id).toBe('b');
  });

  it('ignores recordedAt entirely — a wrong phone clock cannot reorder', () => {
    const result = resolve([
      make({ id: 'mine', lineageId: 'A', value: 72.6, source: 'manual', localSeq: 14, recordedAt: 0 }),
      make({ id: 'theirs', lineageId: 'B', value: 72.4, source: 'manual', serverSeq: 100, recordedAt: 9_999_999_999 }),
    ]);
    expect(result.winner.value).toBe(72.6);
  });
});

describe('guard', () => {
  it('rejects an empty candidate list', () => {
    expect(() => resolve([])).toThrow(/at least one candidate/);
  });
});
