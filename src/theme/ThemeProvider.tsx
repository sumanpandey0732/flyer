import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { darkTheme, lightTheme, type Theme } from './theme';
import { useAppStore } from '@/src/services/StateManager';

const STORAGE_KEY = '@flyer/themeMode';

const ThemeContext = createContext<Theme>(darkTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const mode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setThemeMode(saved);
        }
      })
      .catch(() => {});
  }, [setThemeMode]);

  const theme = useMemo(() => {
    const resolved = mode === 'system' ? (system ?? 'dark') : mode;
    return resolved === 'dark' ? darkTheme : lightTheme;
  }, [mode, system]);

  useEffect(() => {
    // Paints the window background so rotation and keyboard transitions do not
    // flash white in dark mode.
    SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {});
  }, [theme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export async function persistThemeMode(mode: 'system' | 'light' | 'dark') {
  useAppStore.getState().setThemeMode(mode);
  await AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
}
