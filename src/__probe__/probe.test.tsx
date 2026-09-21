import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';

import { store } from '../../src/app/store';
import { GoalsScreen } from '../../src/features/auth/GoalsScreen';

it('dumps the weight TextInput props', async () => {
  await render(
    <Provider store={store}>
      <GoalsScreen />
    </Provider>,
  );
  const input = screen.getByDisplayValue('70');
  const interesting = [
    'editable', 'pointerEvents', 'focusable', 'accessibilityElementsHidden',
    'importantForAccessibility', 'onChangeText', 'style',
  ];
  const out: Record<string, unknown> = {};
  for (const k of interesting) {
    const v = (input.props as Record<string, unknown>)[k];
    out[k] = typeof v === 'function' ? 'fn' : v;
  }
  console.log('INPUT PROPS:', JSON.stringify(out, null, 1));

  // Walk up and report every ancestor that could swallow a touch.
  let node = input.parent;
  const chain: string[] = [];
  while (node) {
    const p = node.props as Record<string, unknown>;
    chain.push(
      `${String(node.type)} pointerEvents=${String(p.pointerEvents)} ` +
      `style=${JSON.stringify(p.style)}`,
    );
    node = node.parent;
  }
  console.log('ANCESTORS:\n' + chain.slice(0, 8).join('\n'));
});
