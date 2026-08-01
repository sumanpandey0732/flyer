import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import {
  PERMISSION_COPY,
  check,
  openSettings,
  request,
  type PermissionName,
  type PermissionResult,
} from '@/src/services/PermissionManager';

/**
 * `null` while the first check is in flight — distinct from 'denied', so the
 * explanatory card never flashes before we know the real answer.
 */
export type PermissionStatus = PermissionResult | null;

export function usePermission(name: PermissionName) {
  const [status, setStatus] = useState<PermissionStatus>(null);

  const refresh = useCallback(async (): Promise<PermissionResult> => {
    const result = await check(name);
    setStatus(result);
    return result;
  }, [name]);

  const requestPermission = useCallback(async (): Promise<PermissionResult> => {
    const result = await request(name);
    setStatus(result);
    return result;
  }, [name]);

  useEffect(() => {
    let cancelled = false;
    check(name).then(
      (result) => {
        if (!cancelled) setStatus(result);
      },
      () => {
        if (!cancelled) setStatus('denied');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [name]);

  return { status, request: requestPermission, refresh };
}

interface Props {
  permission: PermissionName;
  children: React.ReactNode;
}

/** Renders `children` only once `permission` is granted. */
export function PermissionGate({ permission, children }: Props) {
  const theme = useTheme();
  const { status, request: ask } = usePermission(permission);

  if (status === null) return null;
  if (status === 'granted') return <>{children}</>;

  const copy = PERMISSION_COPY[permission];
  const blocked = status === 'blocked';

  return (
    <View style={[styles.wrap, { backgroundColor: theme.colors.bg }]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.bgElevated,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.lg,
            padding: theme.spacing(5),
          },
        ]}
      >
        <Icon name="warning" size={30} color={theme.colors.warning} />

        <Text
          style={[styles.title, { color: theme.colors.text, marginTop: theme.spacing(3) }]}
        >
          {copy.title}
        </Text>

        <Text
          style={[styles.body, { color: theme.colors.textMuted, marginTop: theme.spacing(2) }]}
        >
          {copy.body}
        </Text>

        {/* A blocked permission cannot be re-prompted from JS; settings is the
            only route back, so the primary action changes accordingly. */}
        {blocked ? (
          <Text
            style={[
              styles.note,
              { color: theme.colors.textFaint, marginTop: theme.spacing(2) },
            ]}
          >
            You previously turned this off, so it has to be re-enabled in Settings.
          </Text>
        ) : null}

        <Pressable
          onPress={() => void (blocked ? openSettings() : ask())}
          style={[
            styles.button,
            {
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.pill,
              marginTop: theme.spacing(5),
              paddingVertical: theme.spacing(3),
              paddingHorizontal: theme.spacing(6),
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={blocked ? 'Open settings' : 'Grant permission'}
        >
          <Text style={[styles.buttonText, { color: theme.colors.accentText }]}>
            {blocked ? 'Open settings' : 'Grant permission'}
          </Text>
        </Pressable>

        {blocked ? null : (
          <Pressable
            onPress={openSettings}
            style={[
              styles.secondary,
              { marginTop: theme.spacing(2), paddingVertical: theme.spacing(2) },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Text style={[styles.secondaryText, { color: theme.colors.accent }]}>
              Open settings
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  button: { alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '700' },
  secondary: { alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 14, fontWeight: '600' },
});
