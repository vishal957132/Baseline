import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Provider } from 'react-redux';

import { store } from '../../../app/store';
import { getGoals } from '../../../data/prefs';
import { GoalsScreen } from '../GoalsScreen';

const mounted = () =>
  render(
    <Provider store={store}>
      <GoalsScreen />
    </Provider>,
  );

/**
 * Note `await fireEvent` — in React Native Testing Library 14 both `render`
 * and `fireEvent` are async. Without the await the state update has not
 * flushed, and the assertion reads the previous value.
 */
describe('the goals form accepts typing', () => {
  it('updates the target weight field as the user types', async () => {
    await mounted();
    const weight = screen.getByDisplayValue('70');

    await fireEvent.changeText(weight, '68.5');
    expect(screen.getByDisplayValue('68.5')).toBeTruthy();
  });

  it('updates the daily water field as the user types', async () => {
    await mounted();
    const water = screen.getByDisplayValue('2.5');

    await fireEvent.changeText(water, '3');
    expect(screen.getByDisplayValue('3')).toBeTruthy();
  });

  it('lets the field be cleared', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70'), '');
    expect(screen.getByDisplayValue('')).toBeTruthy();
  });

  /** Backspace, one character at a time — the reported failure. */
  it('deletes characters one at a time', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70'), '7');
    expect(screen.getByDisplayValue('7')).toBeTruthy();

    await fireEvent.changeText(screen.getByDisplayValue('7'), '');
    expect(screen.getByDisplayValue('')).toBeTruthy();

    await fireEvent.changeText(screen.getByDisplayValue(''), '6');
    expect(screen.getByDisplayValue('6')).toBeTruthy();
  });

  it('keeps a half-typed decimal like "68." instead of rejecting it', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70'), '68.');
    expect(screen.getByDisplayValue('68.')).toBeTruthy();
  });

  it('ignores characters a numeric goal cannot hold', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70'), '6a8');
    expect(screen.getByDisplayValue('68')).toBeTruthy();
  });

  it('keeps only the first decimal point', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70'), '68.5.2');
    expect(screen.getByDisplayValue('68.52')).toBeTruthy();
  });

  it('saves what was typed', async () => {
    await mounted();
    await fireEvent.changeText(screen.getByDisplayValue('70'), '68.5');
    await fireEvent.changeText(screen.getByDisplayValue('2.5'), '3');
    await fireEvent.press(screen.getByText('Start tracking'));

    expect(getGoals()).toMatchObject({ weight: 68.5, water: 3000 });
  });
});
