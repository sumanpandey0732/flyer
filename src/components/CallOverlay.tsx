import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Pressable } from './Pressable';
import { Icon } from './Icon';
import { useAppStore } from '@/src/services/StateManager';
import { CallManager, formatCallDuration } from '@/src/services/CallManager';

/**
 * The "you are still on a call" pill. Mounted once at the root, so it must be
 * cheap and silent whenever there is nothing to show.
 */
export function CallOverlay() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const call = useAppStore((s) => s.activeCall);

  const pulse = useRef(new Animated.Value(0)).current;
  const [, forceTick] = useState(0);

  const connectedAt = call?.connectedAt ?? null;
  const hidden = !call || pathname === '/call';

  // The store only re-renders this component when activeCall changes, and the
  // duration is derived from Date.now() — so tick locally while visible.
  useEffect(() => {
    if (hidden || !connectedAt) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [hidden, connectedAt]);

  useEffect(() => {
    if (hidden) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hidden, pulse]);

  if (!call || hidden) return null;

  const status =
    call.state === 'accepted'
      ? connectedAt
        ? formatCallDuration(connectedAt)
        : 'Connecting…'
      : call.state === 'ringing' || call.state === 'calling'
        ? 'Ringing…'
        : 'Call ended';

  const peerName = call.peer?.name ?? 'Unknown';

  return (
    <View
      style={[
        styles.container,
        {
          top: insets.top + theme.spacing(2),
          left: theme.spacing(3),
          right: theme.spacing(3),
          backgroundColor: theme.colors.bgElevated,
          borderRadius: theme.radius.pill,
          borderColor: theme.colors.border,
          paddingLeft: theme.spacing(4),
          paddingRight: theme.spacing(2),
        },
      ]}
    >
      <Pressable
        onPress={() => router.push('/call')}
        style={[styles.tap, { paddingVertical: theme.spacing(2.5) }]}
        accessibilityRole="button"
        accessibilityLabel={`Return to call with ${peerName}`}
      >
        <Animated.View
          style={[
            styles.dot,
            {
              backgroundColor: theme.colors.success,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) },
              ],
            },
          ]}
        />

        <Text
          style={[styles.name, { color: theme.colors.text, marginLeft: theme.spacing(2) }]}
          numberOfLines={1}
        >
          {peerName}
        </Text>

        <Text
          style={[styles.status, { color: theme.colors.textMuted, marginLeft: theme.spacing(2) }]}
        >
          {status}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => void CallManager.hangUp('hangup')}
        haptic
        round={34}
        style={{ backgroundColor: theme.colors.danger }}
        accessibilityRole="button"
        accessibilityLabel="End call"
      >
        <Icon name="endCall" size={16} color={theme.colors.accentText} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 900,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  tap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  name: { flex: 1, fontSize: 15, fontWeight: '600' },
  status: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
