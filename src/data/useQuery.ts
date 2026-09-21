import { useCallback, useEffect, useState } from 'react';

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** When this data was read. Design page 11 stamps cards with it. */
  readAt: number | null;
  reload: () => void;
}

/**
 * Run one query and track its own loading, error and staleness.
 *
 * Deliberately per-query rather than one dashboard-wide fetch: page 11 shows
 * cards resolving independently, each stamped with when it was read, so a slow
 * or failing metric degrades one card instead of blanking the screen.
 */
export function useQuery<T>(run: () => Promise<T>, deps: unknown[] = []): QueryResult<T> {
  const [state, setState] = useState<Omit<QueryResult<T>, 'reload'>>({
    data: null,
    loading: true,
    error: null,
    readAt: null,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const query = useCallback(run, deps);

  const load = useCallback(() => {
    let live = true;
    setState(s => ({ ...s, loading: true }));
    query()
      .then(data => {
        if (live) setState({ data, loading: false, error: null, readAt: Date.now() });
      })
      .catch((e: unknown) => {
        // The previous value is kept: stale data beats an empty card.
        if (live) {
          setState(s => ({ ...s, loading: false, error: String((e as Error)?.message ?? e) }));
        }
      });
    return () => { live = false; };
  }, [query]);

  useEffect(load, [load]);

  return { ...state, reload: load };
}
