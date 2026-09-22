import * as apple from '../adapters/appleHealth';
import * as hc from '../adapters/healthConnect';
import * as feed from '../adapters/jsonFeed';
import {
  connectedProviders, DEFAULT_CONNECTED, importFrom, provider, providersForPlatform,
} from '../registry';
import type { Reading } from '../types';

const AT = Date.UTC(2026, 8, 21, 10, 3); // 21 Sep 2026 10:03 UTC

/** The canonical record every adapter must produce. */
const KEYS = ['externalId', 'metric', 'value', 'recordedAt', 'source'];

describe('three shapes in, one record out', () => {
  it('Apple Health: body_mass, already kilograms', () => {
    const [r] = apple.normalize([
      {
        uuid: 'hk-1',
        sampleType: 'HKQuantityTypeIdentifierBodyMass',
        quantity: { doubleValue: 72.5, unit: 'kg' },
        startDate: new Date(AT).toISOString(),
      },
    ]);
    expect(r).toEqual({
      externalId: 'hk-1',
      metric: 'weight',
      value: 72.5,
      recordedAt: AT,
      source: 'apple_health',
    });
  });

  it('Health Connect: weight in grams, divided to kilograms', () => {
    const [r] = hc.normalize([
      { metadata: { id: 'hc-1' }, recordType: 'weight', weight: { grams: 72_600 }, time: AT },
    ]);
    expect(r).toEqual({
      externalId: 'hc-1',
      metric: 'weight',
      value: 72.6,
      recordedAt: AT,
      source: 'health_connect',
    });
  });

  it('JSON feed: weight_kg carrying kilograms, passed through', () => {
    const [r] = feed.normalize([
      { id: 'jf-1', field: 'weight_kg', val: 72.4, unit: 'kg', ts: AT / 1000 },
    ]);
    expect(r.value).toBe(72.4);
    expect(r.recordedAt).toBe(AT);
  });
});

/**
 * The case the adapter layer exists for. The field is called `weight_kg` but
 * the unit field says pounds. Trusting the name stores 160 as kilograms — a
 * plausible number, wrong by a factor of 2.2, with nothing to flag it.
 */
describe('JSON feed: weight_kg that actually carries pounds', () => {
  const [r] = feed.normalize([
    { id: 'jf-lb', field: 'weight_kg', val: 160, unit: 'lb', ts: AT / 1000 },
  ]);

  it('converts pounds to kilograms', () => {
    expect(r.value).toBeCloseTo(72.5748, 4);
  });

  it('does not take the field name at face value', () => {
    expect(r.value).not.toBe(160);
  });

  it('trusts the unit field, so kg rows in the same feed are untouched', () => {
    const [kg] = feed.normalize([
      { id: 'jf-kg', field: 'weight_kg', val: 72.4, unit: 'kg', ts: AT / 1000 },
    ]);
    expect(kg.value).toBe(72.4);
  });
});

describe('every adapter agrees on the output shape', () => {
  const samples: Reading[] = [
    ...apple.normalize([
      { uuid: 'a', sampleType: 'HKQuantityTypeIdentifierStepCount', quantity: { doubleValue: 7412, unit: 'count' }, startDate: new Date(AT).toISOString() },
    ]),
    ...hc.normalize([{ metadata: { id: 'b' }, recordType: 'steps', count: 7412, time: AT }]),
    ...feed.normalize([{ id: 'c', field: 'step_count', val: 7412, unit: 'steps', ts: AT / 1000 }]),
  ];

  it('produces the same keys from all three', () => {
    for (const r of samples) expect(Object.keys(r).sort()).toEqual([...KEYS].sort());
  });

  it('normalises timestamps to epoch milliseconds from ISO, ms and seconds', () => {
    for (const r of samples) expect(r.recordedAt).toBe(AT);
  });

  it('keeps steps identical across providers, differing only in source', () => {
    expect(samples.map(r => r.value)).toEqual([7412, 7412, 7412]);
    expect(samples.map(r => r.source)).toEqual(['apple_health', 'health_connect', 'json_feed']);
  });

  it('preserves the provider id, which is the import idempotency key', () => {
    expect(samples.map(r => r.externalId)).toEqual(['a', 'b', 'c']);
  });
});

describe('unknown types are skipped, not crashed on', () => {
  it('drops sample types the app does not model', () => {
    expect(apple.normalize([
      { uuid: 'x', sampleType: 'HKQuantityTypeIdentifierHeartRate', quantity: { doubleValue: 61, unit: 'count/min' }, startDate: new Date(AT).toISOString() },
    ])).toEqual([]);
    expect(hc.normalize([{ metadata: { id: 'x' }, recordType: 'hydration', time: AT }])).toEqual([]);
    expect(feed.normalize([{ id: 'x', field: 'vo2max', val: 41, unit: 'ml/kg/min', ts: AT / 1000 }])).toEqual([]);
  });

  it('drops a weight record with no weight payload', () => {
    expect(hc.normalize([{ metadata: { id: 'x' }, recordType: 'weight', time: AT }])).toEqual([]);
  });
});

describe('registry', () => {
  it('resolves by id and throws on an unknown one', () => {
    expect(provider('apple_health').label).toBe('Apple Health');
    expect(() => provider('nope' as never)).toThrow(/Unknown provider/);
  });

  it('offers the legacy feed on every platform, HealthKit only on iOS', () => {
    expect(providersForPlatform('ios').map(p => p.id)).toEqual(['apple_health', 'json_feed']);
    expect(providersForPlatform('android').map(p => p.id)).toEqual(['health_connect', 'json_feed']);
  });

  it('exposes the shape strings the Connect screen shows', () => {
    expect(provider('health_connect').sampleShape).toBe('weight, grams');
    expect(provider('json_feed').sampleShape).toBe('weight_kg, lb values');
  });

  describe('the on/off switch', () => {
    it('imports only from the sources that are switched on', () => {
      expect(connectedProviders(['apple_health'], 'ios').map(p => p.id))
        .toEqual(['apple_health']);
    });

    it('returns nothing when everything is off', () => {
      expect(connectedProviders([], 'ios')).toEqual([]);
    });

    it('still respects the platform — a choice cannot conjure HealthKit on Android', () => {
      expect(connectedProviders(['apple_health'], 'android')).toEqual([]);
    });

    /** Design page 13 shows the legacy feed off: a source whose field names
     *  lie should be opt-in. */
    it('leaves the legacy feed off by default', () => {
      expect(DEFAULT_CONNECTED).not.toContain('json_feed');
      expect(connectedProviders(DEFAULT_CONNECTED, 'ios').map(p => p.id))
        .toEqual(['apple_health']);
    });

    it('turns the legacy feed on when asked', () => {
      expect(connectedProviders([...DEFAULT_CONNECTED, 'json_feed'], 'ios').map(p => p.id))
        .toEqual(['apple_health', 'json_feed']);
    });
  });

  /** One failing source degrades one card; the rest still import. */
  it('keeps other providers when one rejects', async () => {
    const boom = jest
      .spyOn(apple.appleHealth, 'fetch')
      .mockRejectedValueOnce(new Error('permission denied'));

    const results = await importFrom(['apple_health', 'health_connect'], AT - 86_400_000, AT);

    expect(results[0].error).toBe('permission denied');
    expect(results[0].readings).toEqual([]);
    expect(results[1].error).toBeUndefined();
    expect(results[1].readings.length).toBeGreaterThan(0);
    boom.mockRestore();
  });
});
