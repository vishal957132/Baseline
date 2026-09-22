import {
  notifyDataChanged, resetDataListeners, subscribeToData,
} from '../changes';

beforeEach(() => {
  resetDataListeners();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

const flush = () => jest.advanceTimersByTime(60);

describe('the data-changed signal', () => {
  it('tells every listener', () => {
    const a = jest.fn();
    const b = jest.fn();
    subscribeToData(a);
    subscribeToData(b);

    notifyDataChanged();
    flush();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  /** A drain that syncs six ops should cause one reload, not six. */
  it('coalesces a burst into one notification', () => {
    const listener = jest.fn();
    subscribeToData(listener);

    for (let i = 0; i < 6; i++) notifyDataChanged();
    flush();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies again after the window closes', () => {
    const listener = jest.fn();
    subscribeToData(listener);

    notifyDataChanged();
    flush();
    notifyDataChanged();
    flush();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops on unsubscribe, so an unmounted screen is not woken', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToData(listener);

    unsubscribe();
    notifyDataChanged();
    flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it('is harmless with nobody listening', () => {
    expect(() => {
      notifyDataChanged();
      flush();
    }).not.toThrow();
  });

  it('does not fire before its window elapses', () => {
    const listener = jest.fn();
    subscribeToData(listener);

    notifyDataChanged();
    jest.advanceTimersByTime(10);

    expect(listener).not.toHaveBeenCalled();
  });
});
