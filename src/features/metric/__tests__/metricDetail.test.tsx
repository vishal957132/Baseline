/**
 * The metric detail screen's numbers.
 *
 * Two bugs live here that kilograms cannot reveal, because kg → kg is the
 * identity conversion:
 *
 *  - every value is converted once for the chart's y-axis and then formatted
 *    with `formatIn`, which converts again. Invisible in kg, out by 2.2× in lb.
 *  - the statistics were read off the day buckets, so two readings on one day
 *    collapsed and average, lowest and highest all reported the same number.
 *
 * Both are arithmetic that renders a believable wrong answer, so the assertions
 * are on pounds, where a double conversion has somewhere to show.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import goalsReducer from '../../../app/store/goalsSlice';
import unitsReducer from '../../../app/store/unitsSlice';
import { deviceTzOffsetMs, localDayIndex } from '../../../domain/time';
import type { Measurement } from '../../../domain/types';
import type { UnitPrefs } from '../../../domain/units';
import { MetricDetailScreen } from '../MetricDetailScreen';

let mockRouteMetric = 'weight';

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { metricId: mockRouteMetric } }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));



/** All three readings fall on one day, which is what collapses the bucket. */
const AT = Date.UTC(2026, 8, 22, 9, 0);
const reading = (id: string, value: number, minutes: number): Measurement => ({
  id, lineageId: id, laneKey: 'weight:2026-09-22', metric: 'weight',
  value, unit: 'kg', recordedAt: AT + minutes * 60_000,
  updatedAt: 0, source: 'manual', externalId: null,
  serverSeq: 1, localSeq: 1, deletedAt: null,
});

jest.mock('../../../data/measurementRepo', () => ({
  // One day, and its value is the latest reading — weight aggregates 'latest'.
  bucketByDay: jest.fn().mockResolvedValue([{ day: 20_718, value: 99, count: 3 }]),
  // Newest first, as listRange returns them.
  listRange: jest.fn(),
  // Nothing queued: these readings are already on the server.
  pendingLineageIds: jest.fn().mockResolvedValue(new Set<string>()),
}));

const repo = () => jest.requireMock('../../../data/measurementRepo');

const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

async function mount(units: UnitPrefs = {}) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <Provider
        store={configureStore({
          reducer: { goals: goalsReducer, units: unitsReducer },
          preloadedState: { goals: { weight: 70 }, units },
        })}
      >
        <MetricDetailScreen />
      </Provider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockRouteMetric = 'weight';
  repo().bucketByDay.mockResolvedValue([{ day: 20_718, value: 99, count: 3 }]);
  repo().listRange.mockResolvedValue([
    reading('m3', 99, 120),
    reading('m2', 20, 60),
    reading('m1', 80, 0),
  ]);
});

describe('in kilograms', () => {
  it('summarises the readings, not the collapsed day', async () => {
    await mount();
    // 80, 20, 99 — a single day bucket would report 99 for all three.
    // The Stat card renders value and unit as one string. The average is the
    // assertion that carries: 66.3 appears nowhere else on the screen, and a
    // collapsed day bucket would have reported 99.0 for all three.
    expect(await screen.findByText('66.3 kg')).toBeTruthy();  // average
    // The extremes also appear as history rows, hence getAllByText.
    expect(screen.getAllByText('20.0 kg').length).toBeGreaterThan(0);  // lowest
    expect(screen.getAllByText('99.0 kg').length).toBeGreaterThan(0);  // highest
  });

  it('measures the goal against the latest reading', async () => {
    await mount();
    expect(await screen.findByText('Goal · 70.0 kg')).toBeTruthy();
    expect(screen.getByText('29.0 kg to go')).toBeTruthy();
  });
});

describe('what the statistics are computed from', () => {
  /**
   * The headings name the unit of measurement, because the three numbers mean
   * different things per metric — and because a cumulative metric with one
   * day of data shows the same figure three times, which reads as a bug until
   * the labels say "day".
   */
  it('names readings for a point-in-time metric', async () => {
    await mount();
    expect(await screen.findByText('AVERAGE')).toBeTruthy();
    expect(screen.getByText('LOWEST')).toBeTruthy();
    expect(screen.getByText('HIGHEST')).toBeTruthy();
    expect(screen.getByText('From 3 readings in this range')).toBeTruthy();
  });
});

/**
 * The case that looked broken on the device: 3 L and 7 L logged the same
 * afternoon. A cumulative metric summarises days, so both fall in one bucket
 * and average, lowest and highest are all 10 L — correct, and meaningless
 * until the screen says the unit is a day and how many days went in.
 */
describe('a cumulative metric with a single day of readings', () => {
  beforeEach(() => {
    mockRouteMetric = 'water';
    repo().bucketByDay.mockResolvedValue([{ day: 20_718, value: 10_000, count: 2 }]);
    repo().listRange.mockResolvedValue([]);
  });

  it('measures days, and says so', async () => {
    await mount();
    expect(await screen.findByText('AVG / DAY')).toBeTruthy();
    expect(screen.getByText('LOWEST DAY')).toBeTruthy();
    expect(screen.getByText('HIGHEST DAY')).toBeTruthy();
    expect(
      screen.getByText('From 1 day with a reading — a single day is its own highest and lowest'),
    ).toBeTruthy();
  });

  it('totals the day rather than averaging the entries', async () => {
    await mount();
    // 3000 + 7000, not 5000: water accumulates.
    expect(await screen.findAllByText('10000 ml')).toBeTruthy();
  });

  it('converts the day total when litres are selected', async () => {
    await mount({ water: 'l' });
    expect(await screen.findAllByText('10.00 L')).toBeTruthy();
  });
});

describe('in pounds', () => {
  /**
   * 99 kg is 218.3 lb. Converting twice gives 481.2 — which is what the screen
   * rendered, and which nothing in kilograms could have caught.
   */
  it('converts each number exactly once', async () => {
    await mount({ weight: 'lb' });
    expect(await screen.findByText('146.2 lb')).toBeTruthy();   // average: 66.33 kg
    expect(screen.getAllByText('218.3 lb').length).toBeGreaterThan(0);  // highest
    expect(screen.getAllByText('44.1 lb').length).toBeGreaterThan(0);   // lowest
    expect(screen.getByText('218.3')).toBeTruthy();             // the headline
    // What a second conversion would have produced.
    expect(screen.queryByText('481.2')).toBeNull();
  });

  it('converts the goal once as well', async () => {
    await mount({ weight: 'lb' });
    // 70 kg = 154.3 lb; 218.3 - 154.3 = 63.9 lb still to go.
    expect(await screen.findByText('Goal · 154.3 lb')).toBeTruthy();
    expect(screen.getByText('63.9 lb to go')).toBeTruthy();
  });
});

/**
 * Opening on a range that has something in it.
 *
 * The screen always opened on 7 days, so a reading taken a fortnight ago met
 * "No weight yet" on the one screen built to show it. The reading existed; the
 * default window did not reach it.
 */
describe('choosing the opening range', () => {
  const day = (back: number) =>
    localDayIndex(Date.now(), deviceTzOffsetMs()) - back;

  /*
   * Asserted on the goal caption, which names the selected range's span. The
   * repository is mocked and answers any window with the same rows, so
   * "a number rendered" would pass whatever range the screen picked.
   */
  it('stays on 7 days when the last week has readings', async () => {
    repo().bucketByDay.mockResolvedValue([{ day: day(2), value: 80, count: 1 }]);
    await mount();
    expect(await screen.findByText(/of 7 days have a reading/)).toBeTruthy();
  });

  it('widens to 30 days when the reading is older than a week', async () => {
    repo().bucketByDay.mockResolvedValue([{ day: day(8), value: 80, count: 1 }]);
    await mount();
    expect(await screen.findByText(/of 30 days have a reading/)).toBeTruthy();
  });

  it('widens to 3 months when it is older than a month', async () => {
    repo().bucketByDay.mockResolvedValue([{ day: day(45), value: 80, count: 1 }]);
    await mount();
    expect(await screen.findByText(/of 90 days have a reading/)).toBeTruthy();
  });

  it('shows the empty state when there is genuinely nothing', async () => {
    repo().bucketByDay.mockResolvedValue([]);
    repo().listRange.mockResolvedValue([]);
    await mount();
    expect(await screen.findByText('No weight yet')).toBeTruthy();
  });
});

/**
 * The chips have to survive an empty range.
 *
 * They used to render inside the "we have data" branch, so picking a range
 * that turned out to be empty replaced the whole screen with the empty state —
 * chips included. Switching from 30 days to 7 left no way back: the control
 * that would undo the choice was removed by the choice.
 */
describe('a range with nothing in it', () => {
  const day = (back: number) =>
    localDayIndex(Date.now(), deviceTzOffsetMs()) - back;

  /** Reading exists, but not inside the 7-day window the user just picked. */
  const olderThanAWeek = () => {
    repo().bucketByDay.mockImplementation((_m: string, from: number) => {
      const weekish = Date.now() - 8 * 86_400_000;
      return Promise.resolve(
        from <= weekish ? [{ day: day(8), value: 80, count: 1 }] : [],
      );
    });
    repo().listRange.mockResolvedValue([]);
  };

  it('keeps every range selectable so the choice can be undone', async () => {
    olderThanAWeek();
    await mount();
    await screen.findByText('30 days');

    await fireEvent.press(screen.getByText('7 days'));

    // All three still on screen, including the one that would widen again.
    expect(screen.getByText('7 days')).toBeTruthy();
    expect(screen.getByText('30 days')).toBeTruthy();
    expect(screen.getByText('3 months')).toBeTruthy();
  });

  it('says the readings are older rather than that there are none', async () => {
    olderThanAWeek();
    await mount();
    await screen.findByText('30 days');
    await fireEvent.press(screen.getByText('7 days'));

    expect(screen.getByText('No weight in the last 7 days')).toBeTruthy();
    // Not the first-run empty state — this metric does have readings.
    expect(screen.queryByText('No weight yet')).toBeNull();
    expect(screen.queryByText('Add your first entry')).toBeNull();
  });
});
