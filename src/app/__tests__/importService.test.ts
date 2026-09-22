import { importHealthData } from '../importService';
import { clearPrefs, setConnectedSources } from '../../data/prefs';
import { importMeasurements } from '../../data/measurementRepo';
import { importFrom } from '../../providers/registry';

jest.mock('../../data/measurementRepo', () => ({
  importMeasurements: jest.fn().mockResolvedValue({ imported: 0, conflicts: 0 }),
}));
jest.mock('../../providers/registry', () => ({
  ...jest.requireActual('../../providers/registry'),
  importFrom: jest.fn(),
}));

const write = importMeasurements as jest.Mock;
const pull = importFrom as jest.Mock;

const reading = (externalId: string, source: string) => ({
  externalId, source, metric: 'weight', value: 72.5, recordedAt: 1,
});

beforeEach(() => {
  clearPrefs();
  write.mockClear().mockResolvedValue({ imported: 0, conflicts: 0 });
  pull.mockReset();
});

describe('importing health data', () => {
  it('pulls only from the sources that are switched on', async () => {
    setConnectedSources(['apple_health']);
    pull.mockResolvedValue([{ providerId: 'apple_health', readings: [] }]);

    await importHealthData();

    expect(pull.mock.calls[0][0]).toEqual(['apple_health']);
  });

  it('does nothing when every source is off', async () => {
    setConnectedSources([]);
    const summary = await importHealthData();

    expect(pull).not.toHaveBeenCalled();
    expect(summary).toEqual({ imported: 0, conflicts: 0, failed: [] });
  });

  it('hands the normalised readings to the repository', async () => {
    setConnectedSources(['apple_health', 'health_connect']);
    pull.mockResolvedValue([
      { providerId: 'apple_health', readings: [reading('a', 'apple_health')] },
      { providerId: 'health_connect', readings: [reading('b', 'health_connect')] },
    ]);
    write.mockResolvedValue({ imported: 2, conflicts: 1 });

    const summary = await importHealthData();

    expect(write.mock.calls[0][0]).toHaveLength(2);
    expect(summary.imported).toBe(2);
    expect(summary.conflicts).toBe(1);
  });

  /** One failing source degrades one source, not the import. */
  it('still writes what the working sources returned', async () => {
    setConnectedSources(['apple_health', 'health_connect']);
    pull.mockResolvedValue([
      { providerId: 'apple_health', readings: [], error: 'permission denied' },
      { providerId: 'health_connect', readings: [reading('b', 'health_connect')] },
    ]);
    write.mockResolvedValue({ imported: 1, conflicts: 0 });

    const summary = await importHealthData();

    expect(write.mock.calls[0][0]).toHaveLength(1);
    expect(summary.failed).toEqual([
      { providerId: 'apple_health', error: 'permission denied' },
    ]);
  });

  it('reports a total failure without throwing', async () => {
    setConnectedSources(['apple_health']);
    pull.mockResolvedValue([
      { providerId: 'apple_health', readings: [], error: 'store unavailable' },
    ]);

    const summary = await importHealthData();

    expect(summary.imported).toBe(0);
    expect(summary.failed).toHaveLength(1);
  });

  it('asks for a window ending now', async () => {
    setConnectedSources(['apple_health']);
    pull.mockResolvedValue([{ providerId: 'apple_health', readings: [] }]);

    await importHealthData();

    const [, from, to] = pull.mock.calls[0];
    expect(to).toBeGreaterThan(from);
    expect(to).toBeLessThanOrEqual(Date.now());
  });
});
