import React from 'react';
import { Switch as RNSwitch } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

interface Props {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}

/** Themed wrapper so switches match the palette in both schemes. */
export function Switch({ value, onValueChange, disabled, accessibilityLabel }: Props) {
  const theme = useTheme();

  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      trackColor={{ false: theme.colors.border, true: theme.colors.accentDim }}
      thumbColor={value ? theme.colors.accent : theme.colors.textFaint}
      // iOS draws the off-state track itself; without this it stays light grey
      // on a dark background.
      ios_backgroundColor={theme.colors.border}
      style={disabled ? { opacity: 0.5 } : undefined}
    />
  );
}
