import { importHealthData } from '../importService';
import { clearPrefs, setConnectedSources, setImportedMetrics } from '../../data/prefs';
import { importMeasurements } from '../../data/measurementRepo';
import { connectedProviders, importFrom } from '../../providers/registry';

jest.mock('../../data/measurementRepo', () => ({
  importMeasurements: jest.fn().mockResolvedValue({ imported: 0, conflicts: 0 }),
}));
jest.mock('../../providers/registry', () => ({
  ...jest.requireActual('../../providers/registry'),
  importFrom: jest.fn(),
  connectedProviders: jest.fn(),
}));

const write = importMeasurements as jest.Mock;
const pull = importFrom as jest.Mock;
const onThisDevice = connectedProviders as jest.Mock;

const reading = (externalId: string, source: string, metric = 'weight') => ({
  externalId, source, metric, value: 72.5, recordedAt: 1,
});

beforeEach(() => {
  clearPrefs();
  write.mockClear().mockResolvedValue({ imported: 0, conflicts: 0 });
  pull.mockReset();
  // Default: every chosen source exists on this device.
  onThisDevice.mockReset().mockImplementation((ids: string[]) =>
    ids.map(id => ({ id })),
  );
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
    expect(summary).toEqual({ imported: 0, conflicts: 0, failed: [], skipped: 0 });
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

/**
 * The Connect screen offers a metric checklist. It used to be local state that
 * changed nothing, so an import brought in everything the source held whatever
 * the user had unticked.
 */
describe('the metric checklist', () => {
  beforeEach(() => setConnectedSources(['apple_health']));

  it('imports every metric by default', async () => {
    pull.mockResolvedValue([{
      providerId: 'apple_health',
      readings: [reading('a', 'apple_health', 'weight'), reading('b', 'apple_health', 'steps')],
    }]);

    await importHealthData();

    expect(write.mock.calls[0][0]).toHaveLength(2);
  });

  it('drops the metrics the user unticked', async () => {
    setImportedMetrics(['weight']);
    pull.mockResolvedValue([{
      providerId: 'apple_health',
      readings: [reading('a', 'apple_health', 'weight'), reading('b', 'apple_health', 'steps')],
    }]);

    const summary = await importHealthData();

    const written = write.mock.calls[0][0];
    expect(written).toHaveLength(1);
    expect(written[0].metric).toBe('weight');
    expect(summary.skipped).toBe(1);
  });

  /** Filtering after normalisation: the adapter reports what the source holds,
   *  and which of it to keep is the user's decision. */
  it('still asks the provider for everything', async () => {
    setImportedMetrics(['weight']);
    pull.mockResolvedValue([{ providerId: 'apple_health', readings: [] }]);

    await importHealthData();

    expect(pull).toHaveBeenCalled();
  });

  it('does nothing when every metric is unticked', async () => {
    setImportedMetrics([]);
    const summary = await importHealthData();

    expect(pull).not.toHaveBeenCalled();
    expect(summary).toEqual({ imported: 0, conflicts: 0, failed: [], skipped: 0 });
  });
});

/**
 * A stored preference must not cause a read the device cannot serve: Apple
 * Health is iOS-only, and the choice is saved per account, not per platform.
 */
describe('the platform still decides', () => {
  it('reads only the chosen sources this device actually has', async () => {
    setConnectedSources(['apple_health', 'health_connect']);
    // On Android the registry drops the iOS-only source.
    onThisDevice.mockReturnValue([{ id: 'health_connect' }]);
    pull.mockResolvedValue([{ providerId: 'health_connect', readings: [] }]);

    await importHealthData();

    expect(pull.mock.calls[0][0]).toEqual(['health_connect']);
  });

  it('does nothing when no chosen source exists on this device', async () => {
    setConnectedSources(['apple_health']);
    onThisDevice.mockReturnValue([]);

    const summary = await importHealthData();

    expect(pull).not.toHaveBeenCalled();
    expect(summary.imported).toBe(0);
  });
});
