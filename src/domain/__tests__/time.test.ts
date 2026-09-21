import {
  availableRanges,
  deviceTzOffsetMs,
  laneKey,
  localDayIndex,
  localDayKey,
  MS_PER_DAY,
  rangeWindow,
  startOfLocalDayMs,
} from '../time';

const IST = 5.5 * 3_600_000; // +19_800_000
const EST = -5 * 3_600_000; // -18_000_000

/** Epoch ms for a UTC wall-clock time. */
const utc = (iso: string) => Date.parse(`${iso}Z`);

describe('localDayKey', () => {
  /**
   * The three cases from the schema spike. The `- offset` form that was
   * originally proposed gets two of these wrong, and wrongly in a way that
   * still returns a plausible day — which is why they are pinned here.
   */
  it.each([
    ['21 Sep 23:50 IST', '2026-09-21T18:20:00', IST, '2026-09-21'],
    ['22 Sep 02:00 IST', '2026-09-21T20:30:00', IST, '2026-09-22'],
    ['21 Sep 03:00 IST', '2026-09-20T21:30:00', IST, '2026-09-21'],
  ])('%s → %s', (_label, iso, offset, expected) => {
    expect(localDayKey(utc(iso), offset)).toBe(expected);
  });

  it('handles a negative offset', () => {
    // 21 Sep 20:00 EST is 22 Sep 01:00 UTC, but still the 21st locally.
    expect(localDayKey(utc('2026-09-22T01:00:00'), EST)).toBe('2026-09-21');
  });

  it('agrees with UTC when the offset is zero', () => {
    expect(localDayKey(utc('2026-09-21T23:59:59'), 0)).toBe('2026-09-21');
    expect(localDayKey(utc('2026-09-22T00:00:00'), 0)).toBe('2026-09-22');
  });
});

describe('localDayIndex', () => {
  it('advances by exactly one across a local midnight', () => {
    const before = localDayIndex(utc('2026-09-21T18:29:59'), IST);
    const after = localDayIndex(utc('2026-09-21T18:30:00'), IST);
    expect(after - before).toBe(1);
  });
});

describe('startOfLocalDayMs', () => {
  it('returns local midnight, not UTC midnight', () => {
    const start = startOfLocalDayMs(utc('2026-09-21T18:20:00'), IST);
    // 21 Sep 00:00 IST is 20 Sep 18:30 UTC.
    expect(new Date(start).toISOString()).toBe('2026-09-20T18:30:00.000Z');
  });

  it('is idempotent', () => {
    const t = utc('2026-09-21T18:20:00');
    const once = startOfLocalDayMs(t, IST);
    expect(startOfLocalDayMs(once, IST)).toBe(once);
  });
});

describe('laneKey', () => {
  it('is metric plus local day', () => {
    expect(laneKey('weight', utc('2026-09-21T18:20:00'), IST)).toBe(
      'weight:2026-09-21',
    );
  });

  /**
   * The reason this helper exists. A reading at 23:50 local must land in the
   * same lane that the chart buckets it into — if the lane used UTC and the
   * chart used local, they would disagree for every late-evening entry.
   */
  it('matches the bucket the chart query would compute', () => {
    const at = utc('2026-09-21T20:30:00'); // 22 Sep 02:00 IST
    const bucketDay = Math.floor((at + IST) / MS_PER_DAY);
    expect(laneKey('water', at, IST)).toBe(
      `water:${new Date(bucketDay * MS_PER_DAY).toISOString().slice(0, 10)}`,
    );
  });
});

describe('rangeWindow', () => {
  const now = utc('2026-09-21T10:00:00');

  it('covers N local days including today', () => {
    const { from, to } = rangeWindow('7d', now, IST);
    expect((to - from) / MS_PER_DAY).toBe(7);
  });

  it('is half-open, so a 23:59:59.999 reading still falls inside', () => {
    const { to } = rangeWindow('7d', now, IST);
    const lastInstant = to - 1;
    expect(lastInstant).toBeLessThan(to);
    expect(localDayKey(lastInstant, IST)).toBe(localDayKey(now, IST));
  });

  it('starts at local midnight', () => {
    const { from } = rangeWindow('30d', now, IST);
    expect(startOfLocalDayMs(from, IST)).toBe(from);
  });

  it('30d and 3mo are wider than 7d', () => {
    const w7 = rangeWindow('7d', now, IST);
    const w30 = rangeWindow('30d', now, IST);
    const w90 = rangeWindow('3mo', now, IST);
    expect(w30.from).toBeLessThan(w7.from);
    expect(w90.from).toBeLessThan(w30.from);
  });
});

describe('availableRanges', () => {
  // Design page 15: "Ranges unlock as the window fills" — one reading is
  // progress, but it is not a trend, so no range is offered.
  it('offers nothing with a single reading', () => {
    expect(availableRanges(1)).toEqual([]);
  });

  it('offers 7d once two days have readings', () => {
    expect(availableRanges(2)).toContain('7d');
  });

  it('offers every range once the span is wide', () => {
    expect(availableRanges(90)).toEqual(['7d', '30d', '3mo']);
  });
});

describe('deviceTzOffsetMs', () => {
  it('negates getTimezoneOffset so the result is additive', () => {
    // A date whose getTimezoneOffset is stubbed to IST's -330 minutes.
    const fake = { getTimezoneOffset: () => -330 } as Date;
    expect(deviceTzOffsetMs(fake)).toBe(IST);
  });
});
