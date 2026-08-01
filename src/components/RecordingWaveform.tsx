import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

/**
 * Live recording waveform.
 *
 * Bars are driven by real mic metering, pushed in from VoiceRecorder. New
 * samples enter at the right and shift left, which reads as a moving trace
 * rather than a random shimmer.
 */

const BARS = 34;

interface Props {
  /** Latest 0..1 level. Push a new value ~10x/sec. */
  level: number;
  color: string;
}

export function RecordingWaveform({ level, color }: Props) {
  const values = useRef<Animated.Value[]>(
    Array.from({ length: BARS }, () => new Animated.Value(0.08))
  ).current;
  const history = useRef<number[]>(Array(BARS).fill(0.08)).current;

  useEffect(() => {
    history.shift();
    history.push(Math.max(0.08, level));

    // Animate only the tail: animating all 34 every 100ms is wasted work since
    // the older bars are already at their target.
    for (let i = 0; i < BARS; i += 1) {
      const target = history[i];
      const current = (values[i] as unknown as { _value: number })._value;
      if (Math.abs(current - target) < 0.01) continue;

      Animated.timing(values[i], {
        toValue: target,
        duration: 110,
        useNativeDriver: false,
      }).start();
    }
  }, [level, history, values]);

  return (
    <View style={styles.container}>
      {values.map((value, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              backgroundColor: color,
              height: value.interpolate({
                inputRange: [0, 1],
                outputRange: [3, 30],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

/** Pulsing red dot shown next to the recording timer. */
export function RecordingDot() {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[styles.dot, { backgroundColor: theme.colors.danger, opacity: pulse }]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 32,
  },
  bar: { flex: 1, borderRadius: 2, minWidth: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
