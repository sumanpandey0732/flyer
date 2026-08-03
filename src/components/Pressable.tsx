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

/** WCAG 2.5.5 / platform HIG floor for a touchable. */
const MIN_TARGET = 44;
/** hitSlop for controls that size themselves (text buttons, rows). */
const BASE_SLOP = 8;

/**
 * Pressable with sane defaults: platform ripple, `accessibilityRole="button"`,
 * optional haptics, and a 44dp *touch* target for `round` icon buttons.
 *
 * The 44dp guarantee is deliberately scoped to `round`, because that is the only
 * case where this component knows the rendered size. Callers pass values like
 * `round={34}` for visual density; rather than override their layout we widen
 * `hitSlop` to cover the shortfall, so a 34dp circle still answers to a 44dp
 * tap. Everything else keeps the flat 8dp slop — a text button's size comes from
 * its own padding, which this component cannot see.
 */
export function Pressable({
  style,
  haptic = false,
  round,
  onPress,
  onLongPress,
  children,
  accessibilityState,
  ...rest
}: Props) {
  const theme = useTheme();

  // Half the missing width per side is what turns the visual size into a 44dp
  // target. Never shrink below the base slop for buttons that are already large.
  const slop = round
    ? Math.max(BASE_SLOP, Math.ceil((MIN_TARGET - round) / 2))
    : BASE_SLOP;

  return (
    <RNPressable
      accessibilityRole="button"
      android_ripple={{
        color: theme.colors.ripple,
        borderless: Boolean(round),
        radius: round ? round / 2 : undefined,
      }}
      hitSlop={slop}
      onPress={(e) => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress?.(e);
      }}
      onLongPress={
        onLongPress
          ? (e) => {
              // A long-press is the gesture that most needs tactile confirmation:
              // there is no visual "it fired" moment the way a tap has release.
              if (haptic) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              }
              onLongPress(e);
            }
          : undefined
      }
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
      // Derived last so a disabled control is announced as dimmed rather than
      // actionable. `disabled` alone stops the press but says nothing to AT.
      accessibilityState={
        rest.disabled ? { ...accessibilityState, disabled: true } : accessibilityState
      }
    >
      {children}
    </RNPressable>
  );
}
