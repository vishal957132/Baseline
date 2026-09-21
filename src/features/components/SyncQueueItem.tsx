import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, color, space, Text } from '../../ui';

interface Props {
  /** Position within its lane, starting at 1. */
  index: number;
  kind: 'create' | 'update' | 'delete';
  label: string;
  /** Short op id — the idempotency key, shown so a replay is explicable. */
  opId: string;
  localSeq: number;
  status: 'sending' | 'queued' | 'retrying' | 'dead';
  attempts?: number;
  /** Seconds until the next attempt, when retrying. */
  retryInSeconds?: number | null;
  /** True for anything behind the lane's head. */
  heldBehind?: number | null;
}

const CHIP = {
  sending: { label: 'Sending', tone: 'provider' as const },
  queued: { label: 'Queued', tone: 'neutral' as const },
  retrying: { label: 'Retrying', tone: 'warn' as const },
  dead: { label: 'Failed', tone: 'danger' as const },
};

/** One queued upload. The detail line is the engine's state, in words. */
export function SyncQueueItem(p: Props) {
  const chip = CHIP[p.status];
  const detail =
    p.status === 'retrying'
      ? `attempt ${p.attempts ?? 1}, next try in ${p.retryInSeconds ?? 0}s`
      : p.heldBehind != null
        ? `held behind op ${p.heldBehind} in this lane`
        : 'ready, waits on nothing';

  return (
    <View style={styles.row}>
      <Text variant="caption" color="textMuted">{p.index}</Text>
      <View style={styles.body}>
        <Text variant="label">{`${cap(p.kind)} · ${p.label}`}</Text>
        <Text variant="caption" color="textMuted">
          {`op ${p.opId} · local #${p.localSeq} · ${detail}`}
        </Text>
      </View>
      <Chip label={chip.label} tone={chip.tone} />
    </View>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
  },
  body: { flex: 1, gap: 2 },
});
