import {
  availableRanges,
  deviceTzOffsetMs,
  formatDayShort,
  fromLocalDateTime,
  toLocalDateTime,
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
  /** Page 15 keeps "7 days" active and greys the rest — disabling every range
   *  would leave the selected one unselectable. */
  it('keeps the shortest range selectable with a single reading', () => {
    expect(availableRanges(1)).toEqual(['7d']);
  });

  it('locks the longer ranges until there is a trend to see', () => {
    expect(availableRanges(1)).not.toContain('30d');
    expect(availableRanges(1)).not.toContain('3mo');
  });

  it('offers 7d once two days have readings', () => {
    expect(availableRanges(2)).toContain('7d');
  });

  it('offers every range once the span is wide', () => {
    expect(availableRanges(90)).toEqual(['7d', '30d', '3mo']);
  });
});

describe('formatDayShort', () => {
  it('formats a day index the way the x axis shows it', () => {
    const day = Math.floor(Date.UTC(2026, 8, 15) / MS_PER_DAY);
    expect(formatDayShort(day)).toBe('15 Sep');
  });

  it('handles the turn of a month', () => {
    const day = Math.floor(Date.UTC(2026, 0, 1) / MS_PER_DAY);
    expect(formatDayShort(day)).toBe('1 Jan');
  });
});

describe('the log sheet\u2019s date and time', () => {
  it('shows an instant as the local wall clock', () => {
    // 03:13 UTC is 08:43 in IST.
    expect(toLocalDateTime(utc('2026-09-22T03:13:00'), IST)).toEqual({
      date: '2026-09-22',
      time: '08:43',
    });
  });

  it('reads that wall clock back to the same instant', () => {
    const at = utc('2026-09-22T03:13:00');
    const { date, time } = toLocalDateTime(at, IST);
    expect(fromLocalDateTime(date, time, IST)).toBe(at);
  });

  it('round-trips in a negative offset too', () => {
    const at = utc('2026-09-22T03:00:00');
    const { date, time } = toLocalDateTime(at, EST);
    expect(fromLocalDateTime(date, time, EST)).toBe(at);
  });

  it('puts a late-evening entry on the day the user sees', () => {
    // 23:50 on the 21st, in IST.
    const at = fromLocalDateTime('2026-09-21', '23:50', IST)!;
    expect(localDayKey(at, IST)).toBe('2026-09-21');
  });

  it.each([
    ['nonsense', 'yesterday', '10:00'],
    ['a slashed date', '2026/09/22', '10:00'],
    ['a short year', '26-09-22', '10:00'],
    ['a missing minute', '2026-09-22', '10'],
    ['hour 24', '2026-09-22', '24:00'],
    ['minute 60', '2026-09-22', '10:60'],
    ['empty', '', ''],
  ])('rejects %s', (_label, date, time) => {
    expect(fromLocalDateTime(date, time, IST)).toBeNull();
  });

  /** Date.UTC rolls 31 February over to 3 March rather than failing. */
  it('rejects a day that does not exist', () => {
    expect(fromLocalDateTime('2026-02-31', '10:00', IST)).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(fromLocalDateTime('2024-02-29', '10:00', IST)).not.toBeNull();
  });
});

describe('deviceTzOffsetMs', () => {
  it('negates getTimezoneOffset so the result is additive', () => {
    // A date whose getTimezoneOffset is stubbed to IST's -330 minutes.
    const fake = { getTimezoneOffset: () => -330 } as Date;
    expect(deviceTzOffsetMs(fake)).toBe(IST);
  });
});
