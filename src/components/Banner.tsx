import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Pressable } from './Pressable';
import { Icon } from './Icon';

export interface BannerPayload {
  chatId: string;
  senderId: string;
  title: string;
  body: string;
}

interface Props {
  banner: BannerPayload | null;
  onPress: () => void;
  onDismiss: () => void;
}

const HIDDEN_OFFSET = -160;
const AUTO_DISMISS_MS = 4000;

/** In-app heads-up notification for messages that arrive while Flyer is open. */
export function Banner({ banner, onPress, onDismiss }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(HIDDEN_OFFSET)).current;

  // Keyed on chatId + title + body so a second notification from the same chat
  // re-arms the timer instead of inheriting the previous one's remaining time.
  const key = banner ? `${banner.chatId}:${banner.title}:${banner.body}` : null;

  useEffect(() => {
    if (!key) {
      Animated.timing(translateY, {
        toValue: HIDDEN_OFFSET,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }

    translateY.setValue(HIDDEN_OFFSET);
    Animated.timing(translateY, {
      toValue: 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [key]);

  if (!banner) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: 0,
          left: theme.spacing(3),
          right: theme.spacing(3),
          marginTop: insets.top + theme.spacing(2),
          backgroundColor: theme.colors.bgElevated,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          paddingLeft: theme.spacing(4),
          paddingRight: theme.spacing(2),
          transform: [{ translateY }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={[styles.tap, { paddingVertical: theme.spacing(3) }]}
        accessibilityRole="button"
        accessibilityLabel={`${banner.title}: ${banner.body}`}
      >
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
            {banner.title}
          </Text>
          <Text
            style={[
              styles.body,
              { color: theme.colors.textMuted, marginTop: theme.spacing(0.5) },
            ]}
            numberOfLines={2}
          >
            {banner.body}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onDismiss}
        round={36}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
      >
        <Icon name="close" size={16} color={theme.colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 950,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  tap: { flex: 1 },
  copy: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 19 },
});
