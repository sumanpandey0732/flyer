import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Pressable } from '@/src/components/Pressable';
import { Icon } from '@/src/components/Icon';
import { GoogleSignInCancelled, signInWithGoogle } from '@/src/services/AuthManager';

/**
 * Login. Navigation on success is deliberately absent: the root layout watches
 * auth state and swaps the stack, so pushing from here would race it.
 */
export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentSlide = useRef(new Animated.Value(28)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 480,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 7,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(contentSlide, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [logoOpacity, logoScale, contentOpacity, contentSlide]);

  const onSignIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // Leave `busy` true: the root layout is about to unmount this screen and
      // clearing it would flash an enabled button first.
    } catch (e) {
      if (e instanceof GoogleSignInCancelled) {
        setBusy(false);
        return;
      }
      console.warn('[Flyer/login] sign-in failed', e);
      setError(e instanceof Error ? e.message : 'Could not sign in. Please try again.');
      setBusy(false);
    }
  }, []);

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: insets.top + theme.spacing(10),
          paddingBottom: insets.bottom + theme.spacing(8),
        },
      ]}
    >
      <View style={styles.hero}>
        <Animated.View
          style={[
            styles.logo,
            {
              backgroundColor: theme.colors.accent,
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <Icon name="send" size={44} color={theme.colors.accentText} />
        </Animated.View>

        <Animated.View
          style={{ opacity: contentOpacity, transform: [{ translateY: contentSlide }] }}
        >
          <Text style={[styles.appName, { color: theme.colors.text }]}>Flyer</Text>
          <Text style={[styles.tagline, { color: theme.colors.textMuted }]}>
            Messages, calls and stories that keep up with you.
          </Text>
        </Animated.View>
      </View>

      <Animated.View
        style={[
          styles.footer,
          { opacity: contentOpacity, transform: [{ translateY: contentSlide }] },
        ]}
      >
        {error ? (
          <View style={styles.errorBlock}>
            <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>
            <Pressable
              onPress={onSignIn}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Retry sign in"
              style={[styles.retry, { borderColor: theme.colors.border }]}
            >
              <Icon name="retry" size={16} color={theme.colors.accent} />
              <Text style={[styles.retryLabel, { color: theme.colors.accent }]}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={onSignIn}
          disabled={busy}
          haptic
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: busy, busy }}
          style={[
            styles.button,
            {
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.pill,
              opacity: busy ? 0.7 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Text style={[styles.buttonLabel, { color: theme.colors.accentText }]}>
              Continue with Google
            </Text>
          )}
        </Pressable>

        <Text style={[styles.privacy, { color: theme.colors.textFaint }]}>
          Flyer uses your Google account for sign-in only.
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  appName: { fontSize: 40, fontWeight: '700', textAlign: 'center', letterSpacing: 0.5 },
  tagline: { fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  footer: { gap: 16 },
  errorBlock: { alignItems: 'center', gap: 12 },
  errorText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryLabel: { fontSize: 14, fontWeight: '600' },
  button: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  privacy: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
