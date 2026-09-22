import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { ErrorBoundary } from '../ErrorBoundary';

function Boom({ fail }: { fail: boolean }): React.ReactElement {
  if (fail) throw new Error('render exploded');
  return <Text>all good</Text>;
}

// The boundary logs through console.warn on purpose; keep the run quiet.
let warn: jest.SpyInstance;
beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => warn.mockRestore());

describe('the error boundary', () => {
  it('renders its children when nothing is wrong', async () => {
    await render(
      <ErrorBoundary><Boom fail={false} /></ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('catches a render error instead of blanking the app', async () => {
    await render(
      <ErrorBoundary><Boom fail /></ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  /** The claim has to be true: readings are in SQLite, the queue is on disk. */
  it('tells the user their readings are safe', async () => {
    await render(<ErrorBoundary><Boom fail /></ErrorBoundary>);
    expect(screen.getByText(/nothing was lost/i)).toBeTruthy();
  });

  it('shows what went wrong, rather than hiding it', async () => {
    await render(<ErrorBoundary><Boom fail /></ErrorBoundary>);
    expect(screen.getByText('render exploded')).toBeTruthy();
  });

  it('offers a way back', async () => {
    await render(<ErrorBoundary><Boom fail /></ErrorBoundary>);
    await fireEvent.press(screen.getByText('Try again'));
    // Cleared its own state; the child throws again, which is honest rather
    // than pretending the problem went away.
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });
});
