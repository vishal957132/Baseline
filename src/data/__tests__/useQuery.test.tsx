import { act, render } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { notifyDataChanged, resetDataListeners } from '../changes';
import { useQuery } from '../useQuery';

function Probe({ run }: { run: () => Promise<string> }) {
  const { data, loading, error } = useQuery(run, []);
  return <Text>{error ?? (loading && !data ? 'loading' : (data ?? 'none'))}</Text>;
}

beforeEach(resetDataListeners);

describe('useQuery', () => {
  it('shows loading, then the answer', async () => {
    const { getByText } = await render(<Probe run={async () => 'first'} />);
    expect(getByText('first')).toBeTruthy();
  });

  /** Without this a saved reading never appears, and Pending never becomes ✓. */
  it('re-reads when the data changes', async () => {
    let answer = 'first';
    const run = jest.fn(async () => answer);
    const { getByText } = await render(<Probe run={run} />);
    expect(getByText('first')).toBeTruthy();

    answer = 'second';
    await act(async () => {
      notifyDataChanged();
      await new Promise<void>(done => setTimeout(() => done(), 80));
    });

    expect(getByText('second')).toBeTruthy();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good value when a read fails', async () => {
    const run = jest
      .fn<Promise<string>, []>()
      .mockResolvedValueOnce('good')
      .mockRejectedValueOnce(new Error('database locked'));

    const { getByText } = await render(<Probe run={run} />);
    expect(getByText('good')).toBeTruthy();

    await act(async () => {
      notifyDataChanged();
      await new Promise<void>(done => setTimeout(() => done(), 80));
    });

    // Stale data with an error beats a blank card.
    expect(getByText('database locked')).toBeTruthy();
  });

  it('stops listening once unmounted', async () => {
    const run = jest.fn(async () => 'x');
    const view = await render(<Probe run={run} />);
    view.unmount();

    await act(async () => {
      notifyDataChanged();
      await new Promise<void>(done => setTimeout(() => done(), 80));
    });

    expect(run).toHaveBeenCalledTimes(1);
  });
});
