/**
 * The mock server. No backend, no HTTP, no mocking library.
 *
 * A plain class rather than MSW, because the point is to drive failure modes
 * deterministically from tests — latency, 500s, lost acknowledgements — and a
 * seeded random number generator in a constructor does that in a way a service
 * worker cannot.
 *
 * Two behaviours are not dials, because a real server guarantees them:
 *  - every accepted write gets a `serverSeq`, the app's ordering authority;
 *  - the same op id applies once, so replaying after a crash is safe.
 */

export interface MockApiConfig {
  /** Fixed delay, or a [min, max] range. */
  latencyMs?: number | [number, number];
  /** 0..1 chance of a retryable 500. */
  failureRate?: number;
  /**
   * 0..1 chance the write lands but the acknowledgement is lost, so the client
   * retries an op the server already applied. Retrying returns duplicate: true.
   */
  duplicateRate?: number;
  /** No network. Fails instantly, always retryable. */
  forceOffline?: boolean;
  /** Signed in elsewhere (design page 12). A 401 is never retryable. */
  forceUnauthorized?: boolean;
  seed?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Whether the engine should back off and retry, or give up. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Op {
  /** Client-generated. The idempotency key. */
  id: string;
  laneKey: string;
  kind: 'create' | 'update' | 'delete';
  value?: number;
}

export interface ServerRow {
  laneKey: string;
  value: number;
  source: string;
  serverSeq: number;
}

export type PushResult =
  | { status: 'accepted'; serverSeq: number; duplicate: boolean }
  | { status: 'conflict'; server: ServerRow };

const DEFAULTS = {
  latencyMs: 0 as number | [number, number],
  failureRate: 0,
  duplicateRate: 0,
  forceOffline: false,
  forceUnauthorized: false,
};

export class MockApi {
  private config = { ...DEFAULTS };
  private random: () => number;
  private seq = 0;
  /** op id → the answer we gave. The idempotency ledger. */
  private applied = new Map<string, number>();
  /** lane → the server's current value. */
  private rows = new Map<string, ServerRow>();
  /** Lanes holding a value the client has not reconciled with yet. */
  private unreconciled = new Set<string>();

  constructor({ seed = 1, ...config }: MockApiConfig = {}) {
    this.config = { ...DEFAULTS, ...config };
    // A small linear congruential generator: same seed, same run, every time.
    let state = seed;
    this.random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  }

  /** Turn the dials at runtime — the demo's offline toggle uses this. */
  configure(patch: MockApiConfig): void {
    this.config = { ...this.config, ...patch };
  }

  /** Put a value on the server the client has never seen — "from your iPad". */
  preload(row: Omit<ServerRow, 'serverSeq'>): void {
    this.seq += 1;
    this.rows.set(row.laneKey, { ...row, serverSeq: this.seq });
    this.unreconciled.add(row.laneKey);
  }

  /**
   * Send one op. Pass `resolved` after the user picks a winner on the conflict
   * screen, so it overwrites instead of reporting the same conflict forever.
   */
  async push(op: Op, resolved = false): Promise<PushResult> {
    await this.roundTrip();

    // Idempotency first: a replayed op id is answered, never re-applied.
    const seen = this.applied.get(op.id);
    if (seen !== undefined) {
      return { status: 'accepted', serverSeq: seen, duplicate: true };
    }

    if (!resolved && this.unreconciled.has(op.laneKey)) {
      return { status: 'conflict', server: this.rows.get(op.laneKey)! };
    }

    this.seq += 1;
    this.unreconciled.delete(op.laneKey);
    this.applied.set(op.id, this.seq);

    if (op.kind === 'delete') {
      this.rows.delete(op.laneKey);
    } else {
      this.rows.set(op.laneKey, {
        laneKey: op.laneKey,
        value: op.value ?? 0,
        source: 'manual',
        serverSeq: this.seq,
      });
    }

    // Thrown *after* the write is recorded, on purpose: that is exactly what a
    // lost acknowledgement looks like from the client's side.
    if (this.random() < this.config.duplicateRate) {
      throw new ApiError('Connection reset after commit', 0, true);
    }
    return { status: 'accepted', serverSeq: this.seq, duplicate: false };
  }

  /** Everything the server has that the client has not seen yet. */
  async pull(sinceSeq = 0): Promise<ServerRow[]> {
    await this.roundTrip();
    return [...this.rows.values()]
      .filter(r => r.serverSeq > sinceSeq)
      .sort((a, b) => a.serverSeq - b.serverSeq);
  }

  private async roundTrip(): Promise<void> {
    const { forceOffline, forceUnauthorized, failureRate } = this.config;
    if (forceOffline) throw new ApiError('No network connection', 0, true);
    if (forceUnauthorized) throw new ApiError('Session ended on another device', 401, false);

    await new Promise<void>(done => setTimeout(() => done(), this.latency()));

    if (this.random() < failureRate) {
      throw new ApiError('Internal server error', 500, true);
    }
  }

  private latency(): number {
    const { latencyMs } = this.config;
    if (!Array.isArray(latencyMs)) return latencyMs;
    const [min, max] = latencyMs;
    return min + this.random() * (max - min);
  }
}
