import React, { useCallback, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';

/**
 * Chat-list swipe actions.
 *
 * Swipe right pins/unpins, swipe left archives — the same directions WhatsApp
 * uses, so the muscle memory transfers. The action panel is revealed *behind*
 * the row rather than sliding in beside it, which is what makes the row feel
 * like it is being pulled off a stack instead of animating on a canvas.
 *
 * Distinct from `SwipeableRow`, which is swipe-to-reply on a message bubble:
 * that one snaps back always and never commits on release.
 */

/** Drag distance at which the action commits on release. */
const TRIGGER = 76;
/** Hard stop, so a fast flick cannot drag the row off screen. */
const MAX_DRAG = 128;

export interface SwipeAction {
  icon: IconName;
  label: string;
  /** Panel background. Pin uses the accent, archive a neutral slate. */
  color: string;
  onTrigger: () => void;
}

interface Props {
  children: React.ReactNode;
  /** Revealed by a left-to-right drag. */
  right?: SwipeAction;
  /** Revealed by a right-to-left drag. */
  left?: SwipeAction;
  enabled?: boolean;
}

export function SwipeableChatRow({ children, right, left, enabled = true }: Props) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  // Which panel is currently showing. Kept in a ref (not state) so the gesture
  // does not re-render the row on every frame of the drag.
  const activeSide = useRef<'left' | 'right' | null>(null);

  const settle = useCallback(
    (commit: SwipeAction | null) => {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 0,
      }).start(() => {
        activeSide.current = null;
      });
      // Fire after the spring starts, not after it finishes: waiting makes the
      // list reorder a beat behind the finger and reads as lag.
      commit?.onTrigger();
    },
    [translateX]
  );

  const pan = Gesture.Pan()
    .enabled(enabled && Boolean(right || left))
    // Horizontal intent only — a near-vertical drag must stay with the FlatList.
    .activeOffsetX([-16, 16])
    .failOffsetY([-14, 14])
    .onUpdate((event) => {
      const dx = event.translationX;
      const side = dx > 0 ? 'right' : 'left';
      const action = side === 'right' ? right : left;

      if (!action) {
        translateX.setValue(0);
        return;
      }

      activeSide.current = side;

      // Rubber-band past the trigger point so the row feels tethered.
      const magnitude = Math.abs(dx);
      const eased =
        magnitude > TRIGGER ? TRIGGER + (magnitude - TRIGGER) * 0.3 : magnitude;
      const clamped = Math.min(eased, MAX_DRAG);

      translateX.setValue(side === 'right' ? clamped : -clamped);

      // One tick when crossing the threshold, so the commit point is felt
      // rather than guessed.
      if (magnitude >= TRIGGER && !armed.current) {
        armed.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } else if (magnitude < TRIGGER) {
        armed.current = false;
      }
    })
    .onEnd((event) => {
      const side = event.translationX > 0 ? 'right' : 'left';
      const action = side === 'right' ? right : left;
      const commit = armed.current && action ? action : null;
      armed.current = false;
      settle(commit);
    })
    .runOnJS(true);

  // Both panels are mounted and each is clipped to its own half of the row, so
  // the correct one is already in place the instant the drag begins.
  const renderPanel = (action: SwipeAction | undefined, side: 'left' | 'right') => {
    if (!action) return null;
    return (
      <View
        style={[
          styles.panel,
          side === 'right' ? styles.panelRight : styles.panelLeft,
          { backgroundColor: action.color },
        ]}
        pointerEvents="none"
      >
        <View style={styles.panelInner}>
          <Icon name={action.icon} size={22} color="#FFFFFF" />
          <Text style={styles.panelLabel} numberOfLines={1}>
            {action.label}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.colors.bg }]}>
      {renderPanel(right, 'right')}
      {renderPanel(left, 'left')}

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            { backgroundColor: theme.colors.bg },
            { transform: [{ translateX }] },
          ]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { overflow: 'hidden' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
    justifyContent: 'center',
  },
  panelRight: { left: 0, alignItems: 'flex-start', paddingLeft: 24 },
  panelLeft: { right: 0, alignItems: 'flex-end', paddingRight: 24 },
  panelInner: { alignItems: 'center', gap: 4 },
  panelLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
