import { backoffMs, MAX_ATTEMPTS, SyncEngine, type SyncState } from '../engine';
import { ApiError, MockApi } from '../mockApi';
import { memoryOutbox, type Op, type Outbox } from '../outbox';

const op = (id: string, laneKey: string, localSeq: number, value = 1): Op => ({
  id, laneKey, lineageId: id, localSeq,
  kind: 'create', payload: JSON.stringify({ value }),
  status: 'pending', attempts: 0, nextAttemptAt: null,
});

/** A clock the test moves by hand — no waiting for real backoff. */
function fakeClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function build(ops: Op[], overrides: Partial<Parameters<typeof makeDeps>[1]> = {}) {
  return makeDeps(ops, overrides);
}

function makeDeps(
  ops: Op[],
  overrides: {
    push?: jest.Mock;
    online?: boolean;
    outbox?: Outbox;
  } = {},
) {
  const clock = fakeClock();
  const outbox = overrides.outbox ?? memoryOutbox(ops);
  const push = overrides.push ?? jest.fn().mockResolvedValue({ status: 'accepted', serverSeq: 1, duplicate: false });
  const states: SyncState[] = [];
  const engine = new SyncEngine({
    outbox,
    api: { push },
    clock: clock.now,
    netInfo: { isOnline: () => overrides.online ?? true },
    onChange: s => states.push(s),
  });
  return { engine, outbox, push, clock, states };
}

describe('FIFO within a lane', () => {
  it('sends a lane in localSeq order, never out of order', async () => {
    const sent: string[] = [];
    const push = jest.fn(async (o: { id: string }) => {
      sent.push(o.id);
      return { status: 'accepted' as const, serverSeq: sent.length, duplicate: false };
    });
    const { engine } = build(
      [op('c', 'weight:21', 3), op('a', 'weight:21', 1), op('b', 'weight:21', 2)],
      { push },
    );

    await engine.run();
    expect(sent).toEqual(['a', 'b', 'c']);
  });

  it('holds the rest of a lane behind a failed head', async () => {
    const push = jest.fn().mockRejectedValue(new ApiError('boom', 500, true));
    const { engine, outbox, push: p } = build(
      [op('a', 'weight:21', 1), op('b', 'weight:21', 2)],
      { push },
    );

    await engine.run();

    expect(p).toHaveBeenCalledTimes(1); // only the head was attempted
    const all = await outbox.all();
    expect(all.find(o => o.id === 'a')?.status).toBe('failed');
    expect(all.find(o => o.id === 'b')?.status).toBe('pending'); // untouched
  });
});

describe('lane isolation', () => {
  it('a stuck lane does not stop an unrelated one', async () => {
    const push = jest.fn(async (o: { laneKey: string }) => {
      if (o.laneKey.startsWith('weight')) throw new ApiError('boom', 500, true);
      return { status: 'accepted' as const, serverSeq: 1, duplicate: false };
    });
    const { engine, outbox } = build(
      [
        op('w1', 'weight:21', 1),
        op('w2', 'weight:21', 2),
        op('water1', 'water:21', 3),
        op('sleep1', 'sleep:20', 4),
      ],
      { push },
    );

    await engine.run();
    const remaining = await outbox.all();

    // Water and sleep went out; both weight ops are still here.
    expect(remaining.map(o => o.id).sort()).toEqual(['w1', 'w2']);
  });

  it('runs at most three lanes at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const push = jest.fn(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise<void>(done => setTimeout(() => done(), 5));
      inFlight--;
      return { status: 'accepted' as const, serverSeq: 1, duplicate: false };
    });
    const ops = Array.from({ length: 8 }, (_, i) => op(`o${i}`, `lane:${i}`, i + 1));

    await build(ops, { push }).engine.run();
    expect(peak).toBeLessThanOrEqual(3);
    expect(push).toHaveBeenCalledTimes(8); // all of them still got sent
  });
});

describe('backoff and dead-lettering', () => {
  it('doubles the delay: 1s, 2s, 4s, 8s, 16s, 32s', () => {
    expect([0, 1, 2, 3, 4, 5].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 32000]);
  });

  it('will not retry before nextAttemptAt', async () => {
    const push = jest.fn().mockRejectedValue(new ApiError('boom', 500, true));
    const { engine, clock, push: p } = build([op('a', 'weight:21', 1)], { push });

    await engine.run();
    expect(p).toHaveBeenCalledTimes(1);

    await engine.run(); // still inside the backoff window
    expect(p).toHaveBeenCalledTimes(1);

    clock.advance(backoffMs(0) + 1);
    await engine.run();
    expect(p).toHaveBeenCalledTimes(2);
  });

  it('dead-letters the lane after six attempts', async () => {
    const push = jest.fn().mockRejectedValue(new ApiError('500', 500, true));
    const { engine, outbox, clock, push: p } = build([op('a', 'weight:21', 1)], { push });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await engine.run();
      clock.advance(backoffMs(i) + 1);
    }

    expect(p).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    const [stuck] = await outbox.all();
    expect(stuck.attempts).toBe(MAX_ATTEMPTS);
    expect(stuck.status).toBe('dead');

    // Dead means dead: further runs do not touch it.
    clock.advance(10 * 60_000);
    await engine.run();
    expect(p).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('gives up immediately on a non-retryable error', async () => {
    const push = jest.fn().mockRejectedValue(new ApiError('bad request', 400, false));
    const { engine, outbox } = build([op('a', 'weight:21', 1)], { push });

    await engine.run();
    expect((await outbox.all())[0].status).toBe('dead');
  });
});

describe('idempotent replay after a kill', () => {
  /**
   * The op committed on the server but the acknowledgement was lost, then the
   * process died. On relaunch the queue still holds the op and sends it again.
   * The op id is the idempotency key, so the server applies it once.
   */
  it('replays a lost acknowledgement without duplicating the write', async () => {
    const api = new MockApi({ duplicateRate: 1 });
    const ops = [op('op-4f19a2', 'weight:21', 12, 72.8)];
    const clock = fakeClock();
    const outbox = memoryOutbox(ops);
    const deps = {
      outbox,
      api,
      clock: clock.now,
      netInfo: { isOnline: () => true },
    };

    // First launch: the write lands, the ack is lost, the op stays queued.
    await new SyncEngine(deps).run();
    expect(await api.pull(0)).toHaveLength(1);
    expect((await outbox.all())[0].status).toBe('failed');

    // Process dies. Relaunch with a brand new engine over the same queue.
    api.configure({ duplicateRate: 0 });
    clock.advance(backoffMs(0) + 1);
    await new SyncEngine(deps).run();

    expect(await api.pull(0)).toHaveLength(1); // still one row, not two
    expect(await outbox.all()).toEqual([]); // and the queue drained
  });
});

describe('conflicts', () => {
  it('stops the lane and reports the server version', async () => {
    const server = { laneKey: 'weight:21', value: 72.4, source: 'manual', serverSeq: 100 };
    const push = jest.fn().mockResolvedValue({ status: 'conflict', server });
    const { engine, outbox, push: p } = build(
      [op('a', 'weight:21', 1), op('b', 'weight:21', 2)],
      { push },
    );

    const state = await engine.run();

    expect(state.conflicts).toEqual([{ laneKey: 'weight:21', server }]);
    expect(p).toHaveBeenCalledTimes(1); // the lane stopped
    expect((await outbox.all())[0].status).toBe('conflict');
  });

  it('does not retry a conflicted lane until it is cleared', async () => {
    const server = { laneKey: 'weight:21', value: 72.4, source: 'manual', serverSeq: 100 };
    const push = jest.fn().mockResolvedValue({ status: 'conflict', server });
    const { engine, push: p } = build([op('a', 'weight:21', 1)], { push });

    await engine.run();
    await engine.run();
    expect(p).toHaveBeenCalledTimes(1);

    await engine.retryLane('weight:21');
    await engine.run();
    expect(p).toHaveBeenCalledTimes(2);
  });
});

describe('lifecycle', () => {
  it('does nothing while offline', async () => {
    const { engine, push } = build([op('a', 'weight:21', 1)], { online: false });
    const state = await engine.run();
    expect(push).not.toHaveBeenCalled();
    expect(state.online).toBe(false);
  });

  /**
   * Offline is exactly when the dashboard needs the count — "Offline · 3
   * changes waiting to sync". Returning early must still report the queue.
   */
  it('still reports queued work while offline', async () => {
    const { engine } = build(
      [op('a', 'weight:21', 1), op('b', 'weight:21', 2), op('c', 'water:21', 3)],
      { online: false },
    );

    const state = await engine.run();
    expect(state.lanes).toHaveLength(2);
    expect(state.lanes.reduce((n, l) => n + l.queued, 0)).toBe(3);
  });

  it('stops everything on a 401 and flags the session', async () => {
    const push = jest.fn().mockRejectedValue(new ApiError('session ended', 401, false));
    const { engine, push: p } = build(
      [op('a', 'weight:21', 1), op('b', 'water:21', 2)],
      { push },
    );

    const state = await engine.run();
    expect(state.sessionExpired).toBe(true);

    // Lanes already in flight when the 401 arrives will also fail — that is
    // inherent to running them concurrently. What matters is that no *further*
    // work is attempted once the session is known to be dead.
    const duringRun = p.mock.calls.length;
    await engine.run();
    expect(p).toHaveBeenCalledTimes(duringRun);
  });

  it('ignores a second run while one is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    const inFlight = new Promise(resolve => { release = resolve; });
    const push = jest.fn(() => inFlight);
    const { engine, push: p } = build([op('a', 'weight:21', 1)], { push });

    const first = engine.run();
    await engine.run(); // re-entrant: must not send the same op again
    release({ status: 'accepted', serverSeq: 1, duplicate: false });
    await first;

    expect(p).toHaveBeenCalledTimes(1);
  });
});

describe('cancelling un-sent work', () => {
  it('drops every un-sent op for a lineage, create and edits alike', async () => {
    const ops = [op('a', 'weight:21', 1), op('b', 'weight:21', 2)];
    ops[1].lineageId = 'a'; // an edit of the same record
    const { engine, outbox, push } = build(ops);

    // Undo on a record whose create never left: the create and its edit both go.
    expect((await engine.cancel('a')).sort()).toEqual(['a', 'b']);
    expect(await outbox.all()).toEqual([]);

    await engine.run();
    expect(push).not.toHaveBeenCalled(); // nothing left to send
  });

  it('leaves other lineages alone', async () => {
    const { engine, outbox } = build([
      op('a', 'weight:21', 1),
      op('other', 'water:21', 2),
    ]);

    expect(await engine.cancel('a')).toEqual(['a']);
    expect((await outbox.all()).map(o => o.id)).toEqual(['other']);
  });
});

describe('published state', () => {
  it('reports queued counts per lane for the UI', async () => {
    const push = jest.fn().mockRejectedValue(new ApiError('boom', 500, true));
    const { engine, states } = build(
      [op('a', 'weight:21', 1), op('b', 'weight:21', 2), op('c', 'water:21', 3)],
      { push },
    );

    await engine.run();
    const last = states[states.length - 1];
    const weight = last.lanes.find(l => l.laneKey === 'weight:21');

    expect(weight?.queued).toBe(2);
    expect(weight?.status).toBe('retrying');
  });
});
