import { resolve, type Candidate } from '../conflict';

/**
 * What `detectConflict` asks of the resolver, for the readings a real lane
 * holds. The repository only feeds it a lane's live rows and stores the answer,
 * so this is where the decision itself is pinned.
 */
const reading = (p: Partial<Candidate> & { id: string }): Candidate => ({
  lineageId: p.id,
  value: 0,
  source: 'manual',
  serverSeq: null,
  localSeq: 0,
  recordedAt: 0,
  ...p,
});

describe('a manual reading against an imported one', () => {
  /** Exactly the case reported: a seeded Withings reading, then a typed one. */
  const lane = [
    reading({ id: 'seeded', value: 66.1, source: 'withings', serverSeq: 900 }),
    reading({ id: 'typed', value: 95, source: 'manual', localSeq: 20 }),
  ];

  it('asks, because something typed is in contention', () => {
    expect(resolve(lane).outcome).toBe('ask');
  });

  it('suggests what the user typed', () => {
    expect(resolve(lane).winner.value).toBe(95);
  });

  it('offers both readings', () => {
    expect(resolve(lane).candidates.map(c => c.value).sort()).toEqual([66.1, 95]);
  });
});

describe('a manual reading against another manual one', () => {
  /** Two weighings are two weighings, not a disagreement. */
  it('does not ask', () => {
    const lane = [
      reading({ id: 'a', value: 66.1, source: 'manual', serverSeq: 900 }),
      reading({ id: 'b', value: 95, source: 'manual', localSeq: 20 }),
    ];
    expect(resolve(lane).outcome).toBe('auto');
  });

  it('nor for three of them', () => {
    const lane = [
      reading({ id: 'a', value: 72.8, source: 'manual', localSeq: 1 }),
      reading({ id: 'b', value: 72.6, source: 'manual', localSeq: 2 }),
      reading({ id: 'c', value: 72.7, source: 'manual', localSeq: 3 }),
    ];
    expect(resolve(lane).outcome).toBe('auto');
  });
});

describe('imports against each other', () => {
  it('merges silently, newest first', () => {
    const lane = [
      reading({ id: 'a', value: 66.1, source: 'withings', serverSeq: 900 }),
      reading({ id: 'b', value: 66.4, source: 'apple_health', serverSeq: 901 }),
    ];
    const outcome = resolve(lane);
    expect(outcome.outcome).toBe('auto');
    expect(outcome.winner.value).toBe(66.4);
  });
});

describe('what detection needs before it asks at all', () => {
  it('a lane with one reading cannot be in contention', () => {
    expect(resolve([reading({ id: 'only', value: 72 })]).outcome).toBe('auto');
  });

  /**
   * After a decision the losers are soft-deleted, so the lane holds one live
   * reading — which is what stops the same question being asked again.
   */
  it('a lane left with one live reading stops asking', () => {
    const afterResolution = [reading({ id: 'typed', value: 95, source: 'manual' })];
    expect(resolve(afterResolution).outcome).toBe('auto');
  });
});
