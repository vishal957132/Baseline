/**
 * Local-day arithmetic. Every day boundary in the app comes from here — the
 * lane_key written on a reading and the GROUP BY of a chart bucket are the same
 * question, and if they disagree the symptom looks like a sync bug.
 *
 * The offset is ADDED, not subtracted. It is signed: +19_800_000 for IST,
 * -18_000_000 for EST. Subtracting mislabels anything logged late in the
 * evening — see the pinned cases in time.test.ts.
 */

export const MS_PER_DAY = 86_400_000;

/** `2026-09-22` and `08:43`, as the log sheet shows them. */
export interface LocalDateTime {
  date: string;
  time: string;
}

/** Split an instant into the local date and time a person would read off it. */
export function toLocalDateTime(at: number, tzOffsetMs: number): LocalDateTime {
  const local = new Date(at + tzOffsetMs).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/**
 * The reverse. Returns null when the text is not a real moment.
 *
 * The round-trip check is what rejects 31 February: `Date.UTC` rolls it over
 * to 3 March rather than failing, so the only way to know the input was wrong
 * is to format the result back and compare.
 */
export function fromLocalDateTime(
  date: string,
  time: string,
  tzOffsetMs: number,
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;

  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) return null;

  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(wall)) return null;
  if (new Date(wall).toISOString().slice(0, 10) !== date) return null;

  // The wall clock is local, so the offset comes back off to reach UTC.
  return wall - tzOffsetMs;
}

export type RangeId = '7d' | '30d' | '3mo';

export const RANGE_DAYS: Record<RangeId, number> = {
  '7d': 7,
  '30d': 30,
  '3mo': 90,
};

export const RANGE_LABELS: Record<RangeId, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '3mo': '3 months',
};

/** Signed offset from UTC. getTimezoneOffset() reports minutes *behind* UTC. */
export function deviceTzOffsetMs(at: Date = new Date()): number {
  return -at.getTimezoneOffset() * 60_000;
}

/** Days since the epoch in the given zone. The chart's bucket key. */
export function localDayIndex(recordedAt: number, tzOffsetMs: number): number {
  return Math.floor((recordedAt + tzOffsetMs) / MS_PER_DAY);
}

/** `2026-09-21` in the given zone. */
export function localDayKey(recordedAt: number, tzOffsetMs: number): string {
  return dayIndexToKey(localDayIndex(recordedAt, tzOffsetMs));
}

function dayIndexToKey(dayIndex: number): string {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `15 Sep` — the x-axis label format from the design. */
export function formatDayShort(dayIndex: number): string {
  const at = new Date(dayIndex * MS_PER_DAY);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/** Epoch ms of local midnight for the day containing `recordedAt`. */
export function startOfLocalDayMs(recordedAt: number, tzOffsetMs: number) {
  return localDayIndex(recordedAt, tzOffsetMs) * MS_PER_DAY - tzOffsetMs;
}

/** `weight:2026-09-21` */
export function laneKey(metric: string, recordedAt: number, tz: number) {
  return `${metric}:${localDayKey(recordedAt, tz)}`;
}

/**
 * Half-open `[from, to)` for the last N local days including today. Half-open
 * so a 23:59:59.999 reading cannot fall outside it.
 */
export function rangeWindow(range: RangeId, now: number, tzOffsetMs: number) {
  const startOfToday = startOfLocalDayMs(now, tzOffsetMs);
  return {
    from: startOfToday - (RANGE_DAYS[range] - 1) * MS_PER_DAY,
    to: startOfToday + MS_PER_DAY,
  };
}

/**
 * Which ranges are worth offering.
 *
 * The shortest is always selectable — it is the default frame and the screen
 * has to show something. The longer ones need two days with a reading, because
 * one point cannot describe a trend: design page 15 keeps "7 days" active and
 * greys out the rest. Disabling all three, including the selected one, would
 * leave the user unable to choose anything.
 */
export function availableRanges(daysWithData: number): RangeId[] {
  const all = Object.keys(RANGE_DAYS) as RangeId[];
  return daysWithData < 2 ? [all[0]] : all;
}
