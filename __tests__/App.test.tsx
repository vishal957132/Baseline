/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders correctly', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });

  // Unmount so the boot splash timeout is cleared and Jest can exit cleanly.
  await ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});
