import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatValue } from '../../domain/metrics';
import type { Measurement } from '../../domain/types';
import { Chip, color, Icon, ListRow, radius, space, Text } from '../../ui';

/** pending = queued · failed = upload failed · synced = on the server. */
export type RowStatus = 'pending' | 'failed' | 'synced';

interface Props {
  measurement: Measurement;
  status: RowStatus;
  /** Shown only for editable metrics — steps and energy are read-only. */
  onEdit?: () => void;
  onRetry?: () => void;
}

/**
 * A history row: value, when and from where, and where the upload got to.
 *
 * Memoised because it renders inside a list — a re-render here is a re-render
 * per visible row, on every change signal.
 */
function MeasurementRowImpl({ measurement: m, status, onEdit, onRetry }: Props) {
  const when = new Date(m.recordedAt);
  const time = `${when.getDate()} ${when.toLocaleString('en', { month: 'short' })} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;

  return (
    <View style={styles.wrap}>
      <ListRow
        title={`${formatValue(m.metric, m.value)} ${m.unit}`}
        subtitle={status === 'failed' ? `${time} · upload failed` : time}
        danger={status === 'failed'}
        right={
          status === 'pending' ? <Chip label="Pending" tone="warn" />
          : status === 'failed' ? (
            <Pressable onPress={onRetry} style={styles.retry} hitSlop={6}>
              <Text variant="label" color="danger">Retry</Text>
            </Pressable>
          ) : <Icon name="check" size={18} color={color.success} />
        }
      />
      {onEdit && (
        <Pressable onPress={onEdit} style={styles.edit} hitSlop={6}>
          <Icon name="pencil" size={18} color={color.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

export const MeasurementRow = React.memo(MeasurementRowImpl);

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center' },
  edit: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    marginRight: space.sm, borderRadius: radius.md, backgroundColor: color.chipNeutral,
  },
  retry: {
    paddingHorizontal: space.md, paddingVertical: space.xs,
    borderWidth: 1, borderColor: color.danger, borderRadius: radius.pill,
  },
});
