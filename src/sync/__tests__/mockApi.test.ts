import { MockApi, type ApiError } from '../mockApi';

const op = (id: string, value = 72.6, laneKey = 'weight:2026-09-21') =>
  ({ id, laneKey, kind: 'create' as const, payload: JSON.stringify({ value }) });

/** Narrow the union so tests can read `serverSeq` without casting. */
async function accepted(api: MockApi, ...args: Parameters<MockApi['push']>) {
  const result = await api.push(...args);
  if (result.status !== 'accepted') throw new Error('expected accepted');
  return result;
}

describe('accepting writes', () => {
  it('assigns an increasing serverSeq — the ordering authority', async () => {
    const api = new MockApi();
    const a = await accepted(api, op('op-1'));
    const b = await accepted(api, op('op-2', 1800, 'water:2026-09-21'));
    expect(b.serverSeq).toBeGreaterThan(a.serverSeq);
  });

  it('returns only what the client has not seen, oldest first', async () => {
    const api = new MockApi();
    await api.push(op('op-1', 72.6));
    await api.push(op('op-2', 1800, 'water:2026-09-21'));

    const all = await api.pull(0);
    expect(all.map(r => r.laneKey)).toEqual(['weight:2026-09-21', 'water:2026-09-21']);
    expect(await api.pull(all[0].serverSeq)).toHaveLength(1);
    expect(await api.pull(all[1].serverSeq)).toEqual([]);
  });
});

/** Replay safety — what makes retrying after a crash safe. */
describe('idempotency', () => {
  it('applies the same op id once and answers identically', async () => {
    const api = new MockApi();
    const first = await accepted(api, op('op-4f19a2'));
    const again = await accepted(api, op('op-4f19a2'));

    expect(again.serverSeq).toBe(first.serverSeq);
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(await api.pull(0)).toHaveLength(1); // one row, not two
  });
});

/**
 * duplicateRate models a lost acknowledgement: the write commits, then the
 * response never arrives. The client cannot tell that from a total failure, so
 * it retries — and must not end up with two rows.
 */
describe('lost acknowledgement', () => {
  it('commits the write even though the push throws, and dedupes on retry', async () => {
    const api = new MockApi({ duplicateRate: 1 });

    await expect(api.push(op('op-lost'))).rejects.toMatchObject({ retryable: true });
    expect(await api.pull(0)).toHaveLength(1); // it landed

    api.configure({ duplicateRate: 0 });
    expect((await accepted(api, op('op-lost'))).duplicate).toBe(true);
    expect(await api.pull(0)).toHaveLength(1); // still one row
  });
});

describe('failures', () => {
  it('always fails at rate 1, never at rate 0', async () => {
    await expect(new MockApi({ failureRate: 1 }).push(op('a'))).rejects.toMatchObject({
      status: 500,
      retryable: true,
    });
    await expect(new MockApi({ failureRate: 0 }).push(op('a'))).resolves.toBeDefined();
  });

  it('is deterministic for a given seed', async () => {
    const run = async () => {
      const api = new MockApi({ failureRate: 0.5, seed: 42 });
      const out: string[] = [];
      for (let i = 0; i < 12; i++) {
        out.push(await api.push(op(`op-${i}`)).then(() => 'ok', () => 'fail'));
      }
      return out.join(',');
    };
    expect(await run()).toBe(await run());
  });
});

describe('offline and session end are different kinds of failure', () => {
  it('offline fails instantly and is retryable', async () => {
    // Latency is set high to prove offline does not wait for a dead socket.
    const api = new MockApi({ forceOffline: true, latencyMs: 5000 });
    const started = Date.now();
    await expect(api.push(op('a'))).rejects.toMatchObject({ status: 0, retryable: true });
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('a 401 is not retryable — backing off would never help', async () => {
    const api = new MockApi({ forceUnauthorized: true });
    await expect(api.pull(0)).rejects.toMatchObject({ status: 401, retryable: false });
  });
});

describe('latency', () => {
  it('waits for the configured delay', async () => {
    const api = new MockApi({ latencyMs: 60 });
    const started = Date.now();
    await api.push(op('a'));
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });
});

/** The iPad case from design page 10: the server already held 72.4. */
describe('conflicts', () => {
  const laneKey = 'weight:2026-09-21';
  const withIpadRow = () => {
    const api = new MockApi();
    api.preload({ laneKey, value: 72.4, source: 'manual' });
    return api;
  };

  it('reports the server version instead of overwriting it', async () => {
    const result = await withIpadRow().push(op('op-1', 72.6, laneKey));
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') expect(result.server.value).toBe(72.4);
  });

  it('accepts once resolved, and stops reporting', async () => {
    const api = withIpadRow();
    expect((await api.push(op('op-1', 72.6, laneKey))).status).toBe('conflict');
    expect((await api.push(op('op-2', 72.6, laneKey), true)).status).toBe('accepted');
    expect((await api.push(op('op-3', 72.7, laneKey))).status).toBe('accepted');
    expect((await api.pull(0))[0].value).toBe(72.7);
  });
});

describe('error shape', () => {
  it('carries a status and a retryable flag the engine can branch on', async () => {
    const error: ApiError = await new MockApi({ failureRate: 1 })
      .push(op('a'))
      .catch(e => e);
    expect(error.name).toBe('ApiError');
    expect(error.status).toBe(500);
    expect(error.retryable).toBe(true);
  });
});
