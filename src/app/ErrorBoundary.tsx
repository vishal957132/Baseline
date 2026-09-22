import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, color, space, Text } from '../ui';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render error instead of letting it blank the app.
 *
 * It says nothing is lost, and means it: the readings are in SQLite and the
 * queue is on disk, so a crashed render costs a remount and nothing else.
 * Still a class — React offers no hook equivalent of componentDidCatch.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Where a crash reporter would go. Logged so a dev build still shows it.
    console.warn('Render failed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.screen}>
        <Text variant="title" align="center">Something went wrong</Text>
        <Text variant="body" color="textMuted" align="center">
          Your readings are safe on this device — nothing was lost. Try again,
          and if it keeps happening, reopening the app will do no harm.
        </Text>
        <Text variant="caption" color="textMuted" align="center">
          {error.message}
        </Text>
        <Button label="Try again" onPress={() => this.setState({ error: null })} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
    backgroundColor: color.paper,
  },
});
