import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { color, radius, space } from './theme';
import { Text } from './Text';

interface Props {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  /** Suffix shown inside the field, e.g. "kg". */
  unit?: string;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'email-address';
  secure?: boolean;
  autoFocus?: boolean;
}

export function TextField({
  label, value, onChangeText, unit, placeholder, keyboardType = 'default',
  secure, autoFocus,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Text variant="caption" color="textMuted">{label.toUpperCase()}</Text>
      <View style={styles.field}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={color.textMuted}
          keyboardType={keyboardType}
          secureTextEntry={secure}
          autoFocus={autoFocus}
          editable
          returnKeyType="done"
          style={styles.input}
        />
        {unit && <Text variant="body" color="textMuted">{unit}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  input: { flex: 1, minHeight: 52, fontSize: 20, color: color.text },
});
