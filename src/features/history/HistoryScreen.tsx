import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';

import type { RootStackParams } from '../../app/navigation';
import { selectUnits } from '../../app/store/unitsSlice';
import { subscribeToData } from '../../data/changes';
import {
  historyPage, pendingLineageIds, takeLastDeletion, undoDelete, UNDO_WINDOW_MS,
  type UndoableDeletion,
} from '../../data/measurementRepo';
import { EDITABLE_METRICS, metric } from '../../domain/metrics';
import type { Measurement, MetricId } from '../../domain/types';
import { unitFor } from '../../domain/units';
import {
  Banner, EmptyState, Icon, Screen, ScreenHeader, Skeleton, Snackbar, Text, color, radius, space,
} from '../../ui';
import { confirmDeleteMeasurement } from '../components/confirmDelete';
import { MeasurementRow } from '../components/MeasurementRow';
import { rowStatus } from '../components/rowStatus';

/**
 * Rows per page.
 *
 * Keyset paging costs the same at any depth, so this is not about query cost —
 * it is about how much lands on the JS thread at once. A hundred rows took
 * 155 ms to fetch and 414 ms to commit, and a tab press made during that half
 * second simply waits: the tab appears not to respond until the list settles.
 */
const PAGE = 50;

/**
 * The first page is smaller than the rest.
 *
 * Committing rows is synchronous, and a tab pressed during it waits its turn —
 * tapping History and then Sync looked as though Sync had not registered.
 * Fifty rows measured 329 ms to commit; this is roughly a screenful, so the
 * thread is free again quickly and the next pages arrive as the user scrolls,
 * by which point nothing is waiting on them.
 */
const FIRST_PAGE = 24;

/**
 * How far ahead FlashList renders, in pixels beyond the viewport.
 *
 * Straight trade: more headroom means fewer blank cells on a fast fling, and a
 * longer synchronous commit that blocks taps. 2000 made the first commit
 * 414 ms; this is about a third of a screen either side, which keeps the
 * commit short while still rendering ahead of an ordinary scroll.
 */
const DRAW_DISTANCE = 800;

type Row = { kind: 'month'; label: string } | { kind: 'item'; item: Measurement };

/** What is remembered per filter while the user is looking at another one. */
interface CachedList {
  items: Measurement[];
  done: boolean;
  offset: number;
}

/** `undefined` is the All tab, which still needs a key of its own. */
const filterKey = (id: MetricId | undefined) => id ?? 'all';

export function HistoryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const units = useSelector(selectUnits);
  const [filter, setFilter] = useState<MetricId | undefined>('weight');
  const [items, setItems] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoableDeletion | null>(null);
  const listRef = useRef<FlashListRef<Row>>(null);

  /**
   * What each metric had loaded, so returning to it is free.
   *
   * Switching used to throw the pages away and re-query from the first one,
   * which defeats the point of keyset paging: scroll three hundred readings
   * into weight, glance at water, come back, and you are at the top again with
   * three pages to re-fetch. Keyed by filter, holding the rows, whether the
   * end was reached, and where the list was.
   */
  const cache = useRef(new Map<string, CachedList>());
  const offset = useRef(0);
  /** Mirrors `items` for callbacks that must not close over a stale array. */
  const itemsRef = useRef<Measurement[]>([]);
  itemsRef.current = items;

  /**
   * Switching metric is a different list, not a further page of this one.
   *
   * The offset used to survive the change, so a deep position in weight was
   * carried into a shorter dataset and the list sat past its own end drawing
   * nothing. Restoring a cached position is safe for the opposite reason: the
   * rows are the ones that position was measured against.
   */
  function chooseFilter(id: MetricId | undefined) {
    if (id === filter) return;

    cache.current.set(filterKey(filter), {
      items: itemsRef.current,
      done,
      offset: offset.current,
    });

    const restored = cache.current.get(filterKey(id));
    setFilter(id);

    if (restored) {
      setItems(restored.items);
      setDone(restored.done);
      setLoading(false);
      offset.current = restored.offset;
      // After the new rows have been handed to the list, or it would be
      // scrolling the outgoing dataset.
      requestAnimationFrame(() =>
        listRef.current?.scrollToOffset({ offset: restored.offset, animated: false }),
      );
      return;
    }

    setItems([]);
    setDone(false);
    // Synchronously, in the same render as the clear. The empty state shows on
    // "no items and not loading", so clearing without this flashed "No water
    // yet" over an account that has plenty.
    setLoading(true);
    offset.current = 0;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  // Which lineages still have upload work. Re-read with the page, so a badge
  // turns into a tick on the same change signal that refreshes the list.
  const [pending, setPending] = useState<Set<string>>(new Set());

  /**
   * Re-read what this filter already has. Depends only on the filter, so the
   * change subscription below has a stable function to hold.
   *
   * Sized to the rows already loaded rather than to one page: a sync tick used
   * to collapse three hundred rows back to a hundred while the user was
   * scrolled past them.
   */
  const reload = useCallback(async () => {
    setLoading(true);
    const size = Math.max(FIRST_PAGE, itemsRef.current.length);
    try {
      const [page, outstanding] = await Promise.all([
        historyPage(Date.now(), size, filter),
        pendingLineageIds(),
      ]);
      setItems(page);
      setPending(outstanding);
      setDone(page.length < size);
      setError(null);
    } catch (e) {
      // `finally` matters more than the message: without it a failed read
      // leaves the screen loading for ever, with no empty state and no error.
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  /** Keyset paging: the cursor is the oldest recordedAt seen, never an offset. */
  const loadOlder = useCallback(async () => {
    if (loading || done || items.length === 0) return;
    setLoading(true);
    try {
      const page = await historyPage(items[items.length - 1].recordedAt, PAGE, filter);
      setItems(prev => [...prev, ...page]);
      setDone(page.length < PAGE);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [filter, items, loading, done]);

  // Skipped when the filter was restored from cache — those rows are already
  // the answer, and re-querying would undo the restore.
  useEffect(() => {
    if (itemsRef.current.length === 0) reload();
  }, [reload]);

  // A reading saved on the log sheet, or a badge turning into a tick, both
  // arrive here. Reloading the first page is enough: the change the user just
  // made is at the top.
  /*
   * A write invalidates every metric, not just the one on screen — a delete
   * can remove a row from All, an import can add to several at once. Cleared
   * here rather than inside `reload`, which also runs on a filter's first
   * visit and so was wiping the entry saved a moment earlier.
   */
  useEffect(
    () => subscribeToData(() => {
      cache.current.clear();
      reload();
    }),
    [reload],
  );

  // The sheet does the deleting and closes; this is where the undo appears.
  useEffect(() => {
    const deletion = takeLastDeletion();
    if (deletion) setUndo(deletion);
  }, [items]);

  // The offer lasts exactly as long as the upload is held back. After that the
  // delete is on its way, and offering to undo it would be a lie.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  // One function each, not one per row: FlashList recycles cells constantly,
  // and a fresh closure per row would make MeasurementRow's memo useless.
  const confirmDelete = useCallback(
    (m: Measurement) => confirmDeleteMeasurement(m, units),
    [units],
  );

  const openEdit = useCallback(
    (m: Measurement) =>
      nav.navigate('LogEntry', { metricId: m.metric, measurementId: m.id }),
    [nav],
  );

  /*
   * Memoised, because its identity is the list's dataset.
   *
   * Rebuilt on every render it handed FlashList a new array each time the
   * change signal fired — which is on every sync tick — forcing a full re-diff
   * of a list that had not changed.
   */
  const rows = useMemo(() => groupByMonth(items), [items]);

  return (
    <Screen style={styles.screen}>
      <ScreenHeader
        title="History"
        right={
          <Pressable
            onPress={() => nav.navigate('LogEntry', { metricId: filter })}
            accessibilityRole="button"
            accessibilityLabel="Add measurement"
            style={styles.add}
          >
            <Icon name="plus" size={20} color={color.textInverse} />
          </Pressable>
        }
      />

      <View style={styles.filters}>
        {[...EDITABLE_METRICS, undefined].map(id => (
          <Pressable
            key={id ?? 'all'}
            onPress={() => chooseFilter(id)}
            style={[styles.filter, id === filter && styles.filterOn]}
          >
            <Text variant="label" color={id === filter ? 'textInverse' : 'text'}>
              {id ? metric(id).label : 'All'}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && (
        <Banner
          tone="danger"
          icon="alert-triangle"
          title="Could not read your history"
          subtitle={error}
          actionLabel="Try again"
          onAction={reload}
        />
      )}

      {items.length === 0 && !loading ? (
        <EmptyState
          icon="chart-empty"
          // Named, because "Nothing recorded yet" under a Water filter reads as
          // though the whole app were empty.
          title={filter ? `No ${metric(filter).label.toLowerCase()} yet` : 'Nothing recorded yet'}
          body="Add one measurement and it appears here."
          actionLabel="Add your first entry"
          onAction={() => nav.navigate('LogEntry', { metricId: filter })}
        />
      ) : (
        <FlashList
          ref={listRef}
          data={rows}
          keyExtractor={r => (r.kind === 'month' ? r.label : r.item.id)}
          /*
           * Two row shapes, so FlashList is told which is which.
           *
           * Without it a month header and a measurement row share a recycling
           * pool despite differing in height, and a fast scroll shows blank
           * cells while the recycled view is re-measured.
           */
          getItemType={r => r.kind}
          drawDistance={DRAW_DISTANCE}
          /*
           * Anchoring off.
           *
           * FlashList v2 enables maintainVisibleContentPosition by default,
           * for chat lists where content arrives at the top and the view must
           * hold its place against a visible anchor. This list is the other
           * shape: pages append at the bottom during a fling, and the whole
           * dataset is replaced when the metric changes — so the anchor it is
           * holding onto keeps being invalidated mid-scroll, and the list ends
           * up parked at an offset with nothing drawn at it. History reads
           * newest-first from the top; it has no position worth preserving.
           */
          maintainVisibleContentPosition={{ disabled: true }}
          onScroll={e => { offset.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={64}
          onEndReached={loadOlder}
          // Start fetching a screen and a half early. At 0.4 a fast fling
          // reached unloaded space before the next page arrived.
          onEndReachedThreshold={1.5}
          contentContainerStyle={styles.list}
          renderItem={({ item: row }) =>
            row.kind === 'month' ? (
              <Text variant="caption" color="textMuted" style={styles.month}>
                {row.label.toUpperCase()}
              </Text>
            ) : (
              <MeasurementRow
                measurement={row.item}
                unit={unitFor(row.item.metric, units)}
                status={rowStatus(row.item, pending)}
                onEdit={metric(row.item.metric).editable ? openEdit : undefined}
                onDelete={metric(row.item.metric).editable ? confirmDelete : undefined}
              />
            )
          }
          /*
           * Present whenever more rows exist, not only while a fetch is in
           * flight. Tying it to `loading` left a gap between pages where the
           * end of the list was plain background — which reads as the app
           * having lost the rest of the history.
           */
          ListFooterComponent={
            done ? null : <View style={styles.footer}><Skeleton height={44} /></View>
          }
        />
      )}

      <Snackbar
        visible={undo !== null}
        message={`Deleted ${undo?.label ?? ''}`}
        subtitle="Upload paused for 5s"
        actionLabel="Undo"
        onAction={() => {
          if (undo) undoDelete(undo.id, undo.lineageId);
          setUndo(null);
        }}
      />
    </Screen>
  );
}

/** Month headers, as flat rows — FlashList wants one list, not sections. */
function groupByMonth(items: Measurement[]): Row[] {
  const rows: Row[] = [];
  let current = '';
  for (const item of items) {
    const at = new Date(item.recordedAt);
    const label = `${at.toLocaleString('en', { month: 'long' })} ${at.getFullYear()}`;
    if (label !== current) {
      rows.push({ kind: 'month', label });
      current = label;
    }
    rows.push({ kind: 'item', item });
  }
  return rows;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  add: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.ink, borderRadius: radius.md,
  },
  filters: { flexDirection: 'row', gap: space.sm, padding: space.lg },
  filter: {
    paddingHorizontal: space.lg, paddingVertical: space.sm,
    backgroundColor: color.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.border,
  },
  filterOn: { backgroundColor: color.ink, borderColor: color.ink },
  list: { paddingBottom: space.xxl },
  month: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  footer: { padding: space.lg },
});
