import React from 'react';
import { render, screen } from '@testing-library/react-native';

import {
  Banner, Button, Card, Chip, EmptyState, Icon, ListRow, ProgressBar,
  ProgressRing, ScreenHeader, Skeleton, Snackbar, Text, TextField,
} from '..';

/**
 * A smoke pass: every primitive renders, and the ones with arithmetic prove it.
 *
 * Note `await render(...)` — in React Native Testing Library 14 render is
 * async, and `screen` is only populated once it resolves.
 */
describe('primitives render', () => {
  const noop = () => {};

  it('renders text, chips and rows', async () => {
    await render(
      <Card>
        <Text variant="metric">72.6</Text>
        <Chip label="Manual" />
        <ListRow
          title="72.6 kg"
          subtitle="Today 10:03"
          right={<Chip label="Waiting to sync" tone="warn" />}
        />
      </Card>,
    );
    expect(screen.getByText('72.6')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('Waiting to sync')).toBeTruthy();
  });

  it('renders the interactive ones', async () => {
    await render(
      <>
        <Button label="Log a measurement" onPress={noop} icon="plus" />
        <Banner
          tone="warn"
          icon="wifi-off"
          title="Offline"
          subtitle="3 changes waiting"
          actionLabel="View"
          onAction={noop}
        />
        <TextField label="Weight" value="72.6" onChangeText={noop} unit="kg" />
        <Snackbar
          visible
          message="Deleted 73.4 kg"
          subtitle="Upload paused for 5s"
          actionLabel="Undo"
          onAction={noop}
        />
      </>,
    );
    expect(screen.getByText('Log a measurement')).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByText('Undo')).toBeTruthy();
    // The label is upper-cased by TextField.
    expect(screen.getByText('WEIGHT')).toBeTruthy();
    expect(screen.getByDisplayValue('72.6')).toBeTruthy();
  });

  it('renders headers, empty and loading states', async () => {
    await render(
      <>
        <ScreenHeader title="21 September" eyebrow="Monday" badge="DEMO DATA" onBack={noop} />
        <EmptyState
          icon="chart-empty"
          title="No weight yet"
          body="Add one measurement."
          actionLabel="Add your first entry"
          onAction={noop}
          linkLabel="Import"
          onLink={noop}
        />
        <Skeleton height={20} />
        <Icon name="home" />
      </>,
    );
    expect(screen.getByText('MONDAY')).toBeTruthy();
    expect(screen.getByText('DEMO DATA')).toBeTruthy();
    expect(screen.getByText('No weight yet')).toBeTruthy();
    expect(screen.getByText('Add your first entry')).toBeTruthy();
    expect(screen.getByText('Import')).toBeTruthy();
  });

  it('clamps progress to the 0–100% range', async () => {
    await render(<ProgressRing value={7412} max={10000} />);
    expect(screen.getByText('74%')).toBeTruthy();

    await render(<ProgressRing value={-5} max={10000} />);
    expect(screen.getByText('0%')).toBeTruthy();

    await render(<ProgressRing value={99999} max={10000} />);
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('survives a zero max instead of dividing by zero', async () => {
    await render(<ProgressBar value={5} max={0} />);
    expect(screen.toJSON()).toBeTruthy();

    await render(<ProgressRing value={5} max={0} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('hides the snackbar when not visible', async () => {
    await render(<Snackbar visible={false} message="gone" />);
    expect(screen.queryByText('gone')).toBeNull();
  });
});
