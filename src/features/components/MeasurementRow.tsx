import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Measurement } from '../../domain/types';
import { formatIn, type UnitOption } from '../../domain/units';
import { Chip, color, Icon, ListRow, radius, space, Text } from '../../ui';
import { SourceChip } from './SourceChip';

/**
 * pending  queued for upload, waiting its turn
 * failed   an upload that gave up
 * synced   acknowledged by the server
 * stored   on this device, with nothing to upload
 *
 * `stored` exists because an imported reading is none of the other three. It
 * has no server sequence and never will — imports queue nothing, because the
 * reading came from a device rather than from this app — so calling it
 * "waiting to sync" promised an upload that was never going to happen.
 */
export type RowStatus = 'pending' | 'failed' | 'synced' | 'stored';

interface Props {
  measurement: Measurement;
  /** What to show the value in. The row stores nothing and converts nothing. */
  unit: UnitOption;
  status: RowStatus;
  /**
   * Shown only for editable metrics — steps and energy are read-only.
   *
   * Handed the measurement back rather than closing over it, so the list can
   * pass one stable function for every row. A per-row arrow made these props
   * new on each render and defeated the memo below — which is affordable on a
   * short list and is not on eighteen thousand rows being flung past.
   */
  onEdit?: (measurement: Measurement) => void;
  /** Same rule as onEdit. Confirmation is the caller's job, not the row's. */
  onDelete?: (measurement: Measurement) => void;
  onRetry?: (measurement: Measurement) => void;
}

/*
 * Built once, not per row.
 *
 * Each of these is a react-native-svg tree, and three of them render in every
 * row; FlashList recycles cells constantly while scrolling, so rebuilding them
 * per cell was a measurable share of the work that left cells blank on a fast
 * fling. Their colours are constants, so one element each can be shared —
 * React elements are immutable.
 */
const SYNCED_TICK = <Icon name="check" size={18} color={color.success} />;
const EDIT_GLYPH = <Icon name="pencil" size={18} color={color.textMuted} />;
const DELETE_GLYPH = <Icon name="trash" size={18} color={color.danger} />;

/**
 * A history row: value, when and from where, and where the upload got to.
 *
 * Memoised because it renders inside a list — a re-render here is a re-render
 * per visible row, on every change signal.
 */
function MeasurementRowImpl({
  measurement: m, unit, status, onEdit, onDelete, onRetry,
}: Props) {
  const when = new Date(m.recordedAt);
  const time = `${when.getDate()} ${when.toLocaleString('en', { month: 'short' })} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;

  return (
    <View style={styles.wrap}>
      {/*
        The flex:1 is load-bearing. ListRow's own container does not flex —
        only the text block inside it does — so in a row beside other children
        it takes the full width and pushes them off the right edge of the
        screen. That is what made the edit button invisible for as long as it
        existed: rendered, laid out, and off the display.
      */}
      <View style={styles.main}>
        <ListRow
          title={`${formatIn(unit, m.value)} ${unit.label}`}
          subtitle={status === 'failed' ? `${time} · upload failed` : time}
          danger={status === 'failed'}
          right={
            status === 'pending' ? <Chip label="Waiting to sync" tone="warn" />
            : status === 'failed' ? (
              <Pressable onPress={() => onRetry?.(m)} style={styles.retry} hitSlop={6}>
                <Text variant="label" color="danger">Retry</Text>
              </Pressable>
            ) : status === 'stored' ? (
              // Where it came from, which is the useful fact about a reading
              // this app was never going to upload.
              <SourceChip source={m.source} />
            ) : SYNCED_TICK
          }
        />
      </View>
      {onEdit && (
        <Pressable
          onPress={() => onEdit(m)}
          style={styles.action}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${formatIn(unit, m.value)} ${unit.label}`}
        >
          {EDIT_GLYPH}
        </Pressable>
      )}
      {onDelete && (
        <Pressable
          onPress={() => onDelete(m)}
          style={[styles.action, styles.delete]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${formatIn(unit, m.value)} ${unit.label}`}
        >
          {DELETE_GLYPH}
        </Pressable>
      )}
    </View>
  );
}

export const MeasurementRow = React.memo(MeasurementRowImpl);

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1 },
  action: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    marginRight: space.sm, borderRadius: radius.md, backgroundColor: color.chipNeutral,
  },
  delete: { backgroundColor: color.dangerBg },
  retry: {
    paddingHorizontal: space.md, paddingVertical: space.xs,
    borderWidth: 1, borderColor: color.danger, borderRadius: radius.pill,
  },
});
