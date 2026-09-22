import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import type { Measurement } from '../../domain/types';
import { unitFor } from '../../domain/units';
import { ConflictOption } from '../components/ConflictOption';
import { MeasurementRow } from '../components/MeasurementRow';
import { MetricCard } from '../components/MetricCard';
import { MetricChart } from '../components/MetricChart';
import { SourceChip } from '../components/SourceChip';
import { SyncQueueItem } from '../components/SyncQueueItem';

const noop = () => {};
const kg = unitFor('weight');
const ml = unitFor('water');
const series = [72.9, 72.7, 72.6].map((value, day) => ({ day, value }));

const measurement: Measurement = {
  id: 'm1', lineageId: 'm1', laneKey: 'weight:2026-09-21', metric: 'weight',
  value: 72.6, unit: 'kg', recordedAt: Date.UTC(2026, 8, 21, 10, 3),
  updatedAt: 0, source: 'manual', externalId: null,
  serverSeq: null, localSeq: 12, deletedAt: null,
};

describe('SourceChip', () => {
  it('names manual entries and imports differently', async () => {
    await render(<SourceChip source="manual" />);
    expect(screen.getByText('Manual')).toBeTruthy();

    await render(<SourceChip source="apple_health" />);
    expect(screen.getByText('Health')).toBeTruthy();
  });

  it('abbreviates Health Connect, which has to fit a narrow card', async () => {
    await render(<SourceChip source="health_connect" />);
    expect(screen.getByText('HC')).toBeTruthy();
  });
});

describe('MetricCard', () => {
  it('shows the value, unit, source and trend', async () => {
    await render(
      <MetricCard metricId="weight" unit={kg} value={72.6} source="manual" series={series}
        note="↓ 0.5 kg this week" />,
    );
    expect(screen.getByText('Weight')).toBeTruthy();
    expect(screen.getByText('72.6')).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('↓ 0.5 kg this week')).toBeTruthy();
  });

  it('shows a dash rather than a zero when there is no reading', async () => {
    await render(<MetricCard metricId="weight" unit={kg} value={null} source="manual" />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('switches to "of target" when the metric has one', async () => {
    await render(
      <MetricCard metricId="water" unit={ml} value={1800} source="manual" target={2500} />,
    );
    expect(screen.getByText('of 2500 ml')).toBeTruthy();
  });
});

describe('MetricChart', () => {
  it('holds its space for an empty series instead of collapsing the card', async () => {
    const { toJSON } = await render(<MetricChart series={[]} height={40} />);
    // A View with the right height, but no Svg to draw.
    expect(JSON.stringify(toJSON())).not.toContain('Svg');
  });

  /**
   * An SVG needs a pixel width, so the chart measures its container rather
   * than carrying a hardcoded one — otherwise it is the wrong width on every
   * screen size but the one it was tuned on.
   */
  it('draws nothing until layout reports a width', async () => {
    const { toJSON } = await render(<MetricChart series={series} height={40} />);
    expect(JSON.stringify(toJSON())).not.toContain('Svg');
  });

  it('fills the width that layout reports', async () => {
    await render(<MetricChart series={series} height={40} />);

    await fireEvent(screen.getByTestId('metric-chart'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 40 } },
    });

    // The Svg is now as wide as the container said it could be.
    expect(JSON.stringify(screen.toJSON())).toContain('320');
  });

  /** 90 points in a phone-width card is under 2px per bar. */
  it('scrolls horizontally rather than squeezing a dense series', async () => {
    const dense = Array.from({ length: 90 }, (_, day) => ({ day, value: day }));
    await render(<MetricChart series={dense} height={40} />);
    await fireEvent(screen.getByTestId('metric-chart'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 40 } },
    });

    expect(screen.getByTestId('metric-chart-scroll')).toBeTruthy();
    // Drawn wider than the container: 90 points at 14px each.
    expect(JSON.stringify(screen.toJSON())).toContain('1260');
  });

  it('does not scroll when the series already fits', async () => {
    await render(<MetricChart series={series} height={40} />);
    await fireEvent(screen.getByTestId('metric-chart'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 40 } },
    });
    expect(screen.queryByTestId('metric-chart-scroll')).toBeNull();
  });

  /** A sparkline is a glance, not something to explore. */
  it('never scrolls a sparkline', async () => {
    const dense = Array.from({ length: 90 }, (_, day) => ({ day, value: day }));
    await render(<MetricChart series={dense} height={38} bare />);
    await fireEvent(screen.getByTestId('metric-chart'), 'layout', {
      nativeEvent: { layout: { width: 130, height: 38 } },
    });
    expect(screen.queryByTestId('metric-chart-scroll')).toBeNull();
  });

  it('labels the x axis with dates when asked', async () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map(d => ({
      day: Math.floor(Date.UTC(2026, 8, 15 + d) / 86_400_000),
      value: 72 + d * 0.1,
    }));
    await render(<MetricChart series={days} height={160} xAxis />);
    await fireEvent(screen.getByTestId('metric-chart'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 160 } },
    });

    // Labels are SvgText, which byText queries do not reach, so read the tree.
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toContain('15 Sep');
    expect(tree).toContain('21 Sep');
  });

  it('labels the y axis with the gridline values when asked', async () => {
    await render(<MetricChart series={series} height={160} yAxis />);
    await fireEvent(screen.getByTestId('metric-chart'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 160 } },
    });
    // Three gridlines, three distinct labels. Over a 0.3 kg span one decimal
    // would print "72.8" three times, so the precision follows the span.
    const labels = screen.getAllByText(/^72\./).map(n => n.props.children);
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(3);
  });

  it('draws no axes by default, matching the design', async () => {
    await render(<MetricChart series={series} height={160} />);
    await fireEvent(screen.getByTestId('metric-chart'), 'layout', {
      nativeEvent: { layout: { width: 320, height: 160 } },
    });
    expect(screen.queryByText(/^72\./)).toBeNull();
  });

  /** The gutter must not overlap the plot — it is subtracted from the width. */
  it('takes the y-axis gutter out of the plot width', async () => {
    await render(<MetricChart series={series} width={320} height={160} yAxis />);
    const withAxis = JSON.stringify(screen.toJSON());

    await render(<MetricChart series={series} width={320} height={160} />);
    const withoutAxis = JSON.stringify(screen.toJSON());

    expect(withAxis).toContain('286'); // 320 - 34
    expect(withoutAxis).toContain('320');
  });

  it('never draws axes on a sparkline', async () => {
    await render(<MetricChart series={series} height={38} bare xAxis yAxis />);
    await fireEvent(screen.getByTestId('metric-chart'), 'layout', {
      nativeEvent: { layout: { width: 130, height: 38 } },
    });
    expect(screen.queryByText(/^72\./)).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('Sep');
  });

  it('honours an explicit width when one is given', async () => {
    const { toJSON } = await render(
      <MetricChart series={series} width={100} height={40} />,
    );
    expect(JSON.stringify(toJSON())).toContain('100');
  });

  it('renders both variants', async () => {
    expect((await render(
      <MetricChart series={series} width={100} height={40} variant="line" />,
    )).toJSON()).toBeTruthy();
    expect((await render(
      <MetricChart series={series} width={100} height={40} variant="bars" goal={72.8} />,
    )).toJSON()).toBeTruthy();
  });
});

describe('MeasurementRow', () => {
  it('marks an un-uploaded reading as pending', async () => {
    await render(<MeasurementRow measurement={measurement} unit={kg} status="pending" />);
    expect(screen.getByText('72.6 kg')).toBeTruthy();
    expect(screen.getByText('Waiting to sync')).toBeTruthy();
  });

  it('offers a retry on a failed upload', async () => {
    await render(
      <MeasurementRow measurement={measurement} unit={kg} status="failed" onRetry={noop} />,
    );
    expect(screen.getByText('Retry')).toBeTruthy();
    expect(screen.getByText(/upload failed/)).toBeTruthy();
  });

  /** Read-only metrics get no edit affordance at all. */
  it('hides edit unless an onEdit is given', async () => {
    const withEdit = await render(
      <MeasurementRow measurement={measurement} unit={kg} status="synced" onEdit={noop} />,
    );
    const withoutEdit = await render(
      <MeasurementRow measurement={measurement} unit={kg} status="synced" />,
    );
    expect(JSON.stringify(withEdit.toJSON()).length)
      .toBeGreaterThan(JSON.stringify(withoutEdit.toJSON()).length);
  });

  /**
   * The row converts nothing itself — it shows whatever unit it is handed. The
   * point of the assertion is that 72.6 kg is 160.1 lb and not 72.6 lb.
   */
  it('renders the value in the unit it is given', async () => {
    await render(
      <MeasurementRow measurement={measurement} unit={unitFor('weight', { weight: 'lb' })}
        status="synced" />,
    );
    expect(screen.getByText('160.1 lb')).toBeTruthy();
  });

  it('offers delete only when a handler is given', async () => {
    const withDelete = await render(
      <MeasurementRow measurement={measurement} unit={kg} status="synced" onDelete={noop} />,
    );
    const withoutDelete = await render(
      <MeasurementRow measurement={measurement} unit={kg} status="synced" />,
    );
    expect(JSON.stringify(withDelete.toJSON()).length)
      .toBeGreaterThan(JSON.stringify(withoutDelete.toJSON()).length);
  });
});

describe('SyncQueueItem', () => {
  /**
   * Plain language, and only claims the screen can stand behind.
   *
   * It used to print "op -09-21 · local #12". Neither was real: the id was the
   * tail of the lane key and the sequence was the retry count plus twelve. The
   * screen is handed a lane's state and no per-operation data, so inventing
   * identifiers made it look precise while being wrong.
   */
  it('says what is waiting and when it will be tried again', async () => {
    await render(
      <SyncQueueItem label="Weight · 21 Sep" count={1} status="retrying"
        attempts={3} retryInSeconds={8} />,
    );
    expect(screen.getByText('Weight · 21 Sep')).toBeTruthy();
    expect(screen.getByText(/trying again in 8s \(attempt 3\)/)).toBeTruthy();
    expect(screen.getByText('Trying again')).toBeTruthy();
  });

  it('reassures that a waiting change is not lost', async () => {
    await render(<SyncQueueItem label="Water · 21 Sep" count={1} status="queued" />);
    expect(screen.getByText(/Safe on this device/)).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
  });

  it('counts the group only when it holds more than one change', async () => {
    await render(<SyncQueueItem label="Weight · 21 Sep" count={3} status="sending" />);
    expect(screen.getByText('Weight · 21 Sep · 3 changes')).toBeTruthy();
    expect(screen.getByText('Uploading now')).toBeTruthy();
  });

  /** No "op", no "lane", no "local seq" anywhere a user can read. */
  it('keeps the engine’s vocabulary off the screen', async () => {
    const { toJSON } = await render(
      <SyncQueueItem label="Weight · 21 Sep" count={2} status="dead" attempts={6} />,
    );
    const rendered = JSON.stringify(toJSON());
    for (const jargon of ['op ', 'lane', 'local #', 'seq']) {
      expect(rendered.toLowerCase()).not.toContain(jargon);
    }
  });
});

describe('ConflictOption', () => {
  it('marks the suggested candidate and reports selection to assistive tech', async () => {
    await render(
      <ConflictOption metricId="weight" value={72.6} title="your correction"
        detail="Manual · this phone" selected suggested onPress={noop} />,
    );
    expect(screen.getByText(/72.6 kg — your correction/)).toBeTruthy();
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.getByRole('radio', { selected: true })).toBeTruthy();
  });

  it('renders an unselected candidate without the badge', async () => {
    await render(
      <ConflictOption metricId="weight" value={72.4} title="from your iPad"
        detail="Manual · already on the server" selected={false} onPress={noop} />,
    );
    expect(screen.queryByText('Suggested')).toBeNull();
    expect(screen.getByRole('radio', { selected: false })).toBeTruthy();
  });
});
