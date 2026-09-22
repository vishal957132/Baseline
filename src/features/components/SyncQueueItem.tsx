import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, color, space, Text } from '../../ui';

export type QueueStatus = 'sending' | 'queued' | 'retrying' | 'dead';

interface Props {
  /** What is waiting, in the user's terms: "Weight · 21 Sep". */
  label: string;
  /** How many changes this covers. Named only when it is more than one. */
  count: number;
  status: QueueStatus;
  attempts?: number;
  /** Seconds until the next attempt, when retrying. */
  retryInSeconds?: number | null;
}

const CHIP: Record<
  QueueStatus,
  { label: string; tone: 'provider' | 'neutral' | 'warn' | 'danger' }
> = {
  sending: { label: 'Sending', tone: 'provider' },
  queued: { label: 'Waiting', tone: 'neutral' },
  retrying: { label: 'Trying again', tone: 'warn' },
  dead: { label: 'Not sent', tone: 'danger' },
};

/**
 * One group of waiting uploads.
 *
 * This used to print an operation id and a local sequence number, and both
 * were invented: the id was the last six characters of the lane key, which
 * rendered as "op -09-21", and the sequence was the retry count plus twelve.
 * The screen is given a lane's state and no per-operation data at all, so it
 * now says only what it actually knows.
 *
 * The words are the user's rather than the engine's. Someone opening this
 * screen wants to know whether their reading is safe and when it will arrive;
 * "op", "lane" and "local seq" answer neither question. The architecture is
 * still worth explaining — it is explained in the README, to another reader.
 */
export function SyncQueueItem({
  label, count, status, attempts, retryInSeconds,
}: Props) {
  const chip = CHIP[status];

  const detail =
    status === 'retrying'
      ? `Couldn’t reach the server — trying again in ${retryInSeconds ?? 0}s (attempt ${attempts ?? 1})`
      : status === 'sending'
        ? 'Uploading now'
        : status === 'dead'
          ? 'Safe on this device. Tap below to try again'
          : 'Safe on this device. Uploads on its own';

  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <Text variant="label" numberOfLines={1}>
          {count > 1 ? `${label} · ${count} changes` : label}
        </Text>
        <Text variant="caption" color="textMuted">{detail}</Text>
      </View>
      <Chip label={chip.label} tone={chip.tone} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
  },
  body: { flex: 1, gap: 2 },
});
