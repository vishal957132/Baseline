/**
 * "Delete this entry?" — shared by History and the metric detail screen.
 *
 * One copy rather than one per screen: a destructive action whose wording,
 * confirmation and lane handling are duplicated is a destructive action that
 * will eventually differ between two places, and the version that drifts is
 * the one that deletes from the wrong lane.
 *
 * The undo lives on History and holds the upload back for a few seconds, so
 * this is recoverable — but only if the user is looking at History, which is
 * why it still asks first.
 */

import { Alert } from 'react-native';

import { removeMeasurement } from '../../data/measurementRepo';
import type { Measurement } from '../../domain/types';
import { formatIn, unitFor, type UnitPrefs } from '../../domain/units';

export function confirmDeleteMeasurement(m: Measurement, units: UnitPrefs): void {
  const unit = unitFor(m.metric, units);
  const label = `${formatIn(unit, m.value)} ${unit.label}`;

  Alert.alert(
    'Delete this entry?',
    `${label} will be removed from your history. You can undo this for a few seconds afterwards.`,
    [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeMeasurement({
            id: m.id,
            lineageId: m.lineageId,
            // The reading's own lane, never today's: deleting a reading from
            // last Tuesday must not touch this morning's queue.
            laneKey: m.laneKey,
            source: 'manual',
            now: Date.now(),
            label,
          });
        },
      },
    ],
  );
}
