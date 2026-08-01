import React from 'react';
import {
  Pressable as RNPressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';

interface Props extends PressableProps {
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
  /** Adds a circular ripple; use for icon buttons. */
  round?: number;
}

/**
 * Pressable with sane defaults: platform ripple, a 44pt minimum hit target for
 * accessibility, and optional haptics.
 */
export function Pressable({
  style,
  haptic = false,
  round,
  onPress,
  children,
  ...rest
}: Props) {
  const theme = useTheme();

  return (
    <RNPressable
      android_ripple={{
        color: theme.colors.ripple,
        borderless: Boolean(round),
        radius: round ? round / 2 : undefined,
      }}
      hitSlop={8}
      onPress={(e) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.(e);
      }}
      style={({ pressed }) => [
        round
          ? {
              width: round,
              height: round,
              borderRadius: round / 2,
              alignItems: 'center',
              justifyContent: 'center',
            }
          : null,
        pressed ? { opacity: 0.6 } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </RNPressable>
  );
}
