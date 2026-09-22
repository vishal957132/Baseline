import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FlashList } from '@shopify/flash-list';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { RootStackParams } from '../../app/navigation';
import { subscribeToData } from '../../data/changes';
import { historyPage } from '../../data/measurementRepo';
import { EDITABLE_METRICS, metric } from '../../domain/metrics';
import type { Measurement, MetricId } from '../../domain/types';
import {
  Banner, color, EmptyState, Icon, radius, ScreenHeader, Skeleton, Snackbar,
  space, Text,
} from '../../ui';
import { MeasurementRow } from '../components/MeasurementRow';

const PAGE = 50;

type Row = { kind: 'month'; label: string } | { kind: 'item'; item: Measurement };

export function HistoryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [filter, setFilter] = useState<MetricId | undefined>('weight');
  const [items, setItems] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);

  /** Newest page, from scratch. Depends only on the filter, so the change
   *  subscription below has a stable function to hold. */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const page = await historyPage(Date.now(), PAGE, filter);
      setItems(page);
      setDone(page.length < PAGE);
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

  useEffect(() => {
    reload();
  }, [reload]);

  // A reading saved on the log sheet, or a badge turning into a tick, both
  // arrive here. Reloading the first page is enough: the change the user just
  // made is at the top.
  useEffect(() => subscribeToData(reload), [reload]);

  const rows = groupByMonth(items);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
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
            onPress={() => setFilter(id)}
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
          data={rows}
          keyExtractor={r => (r.kind === 'month' ? r.label : r.item.id)}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.4}
          contentContainerStyle={styles.list}
          renderItem={({ item: row }) =>
            row.kind === 'month' ? (
              <Text variant="caption" color="textMuted" style={styles.month}>
                {row.label.toUpperCase()}
              </Text>
            ) : (
              <MeasurementRow
                measurement={row.item}
                status={row.item.serverSeq === null ? 'pending' : 'synced'}
                onEdit={
                  metric(row.item.metric).editable
                    ? () => nav.navigate('LogEntry', {
                        metricId: row.item.metric, measurementId: row.item.id,
                      })
                    : undefined
                }
              />
            )
          }
          ListFooterComponent={
            loading ? <View style={styles.footer}><Skeleton height={44} /></View> : null
          }
        />
      )}

      <Snackbar
        visible={undo !== null}
        message={undo ?? ''}
        subtitle="Upload paused for 5s"
        actionLabel="Undo"
        onAction={() => setUndo(null)}
      />
    </SafeAreaView>
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
