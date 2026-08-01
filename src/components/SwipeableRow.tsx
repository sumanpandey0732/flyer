import React, { useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Icon } from './Icon';

/**
 * Swipe-to-reply.
 *
 * Runs on the UI thread via Reanimated's gesture handler so the drag tracks the
 * finger even while the message list is re-rendering. `activeOffsetX` keeps the
 * FlatList's vertical scroll from being stolen by a near-vertical drag.
 */

const TRIGGER_DISTANCE = 56;
const MAX_DRAG = 84;

interface Props {
  children: React.ReactNode;
  onReply: () => void;
  /** Outgoing bubbles swipe right-to-left, incoming left-to-right. */
  mine: boolean;
  enabled?: boolean;
}

export function SwipeableRow({ children, onReply, mine, enabled = true }: Props) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const triggered = useRef(false);

  const direction = mine ? -1 : 1;

  const reset = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
    Animated.timing(iconOpacity, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start();
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(mine ? [-14, 9999] : [-9999, 14])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      // Only allow travel in the reply direction.
      const raw = event.translationX * direction;
      if (raw <= 0) {
        translateX.setValue(0);
        iconOpacity.setValue(0);
        return;
      }

      // Rubber-band past the trigger point so the gesture feels bounded.
      const clamped = raw > TRIGGER_DISTANCE
        ? TRIGGER_DISTANCE + (raw - TRIGGER_DISTANCE) * 0.25
        : raw;

      translateX.setValue(Math.min(clamped, MAX_DRAG) * direction);
      iconOpacity.setValue(Math.min(1, raw / TRIGGER_DISTANCE));

      if (raw >= TRIGGER_DISTANCE && !triggered.current) {
        triggered.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
      if (raw < TRIGGER_DISTANCE) triggered.current = false;
    })
    .onEnd(() => {
      if (triggered.current) onReply();
      triggered.current = false;
      reset();
    })
    .runOnJS(true);

  return (
    <View style={styles.wrapper}>
      <Animated.View
        style={[
          styles.iconTrack,
          mine ? { right: 12 } : { left: 12 },
          { opacity: iconOpacity },
        ]}
        pointerEvents="none"
      >
        <View style={[styles.iconCircle, { backgroundColor: theme.colors.surfaceAlt }]}>
          <Icon name="reply" size={16} color={theme.colors.textMuted} />
        </View>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={{ transform: [{ translateX }] }}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { justifyContent: 'center' },
  iconTrack: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
