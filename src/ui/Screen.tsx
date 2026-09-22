import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color } from './theme';

type Edge = 'top' | 'bottom';

interface Props {
  children: React.ReactNode;
  /** Which system insets to keep clear of. Top only, unless told otherwise. */
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}

/**
 * A screen container that respects the system insets from the first frame.
 *
 * This replaces `SafeAreaView` from react-native-safe-area-context, which
 * measures itself natively after mounting: the first frame paints with no
 * padding, and the content jumps down once the measurement lands. On a screen
 * reached by a tab press that is plainly visible — the title draws over the
 * status bar and then drops into place a moment later.
 *
 * `useSafeAreaInsets` reads values the provider already holds, so the padding
 * is right on the first render and there is nothing to correct.
 */
export function Screen({ children, edges = ['top'], style }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        edges.includes('top') && { paddingTop: insets.top },
        edges.includes('bottom') && { paddingBottom: insets.bottom },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
});
