import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Pressable } from '@/src/components/Pressable';
import { Icon } from '@/src/components/Icon';
import {
  GoogleSignInCancelled,
  authErrorMessage,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '@/src/services/AuthManager';

type Mode = 'landing' | 'signin' | 'signup' | 'reset';

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('landing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentSlide = useRef(new Animated.Value(28)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, { toValue: 1, duration: 480, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(contentSlide, { toValue: 0, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();
  }, [logoOpacity, logoScale, contentOpacity, contentSlide]);

  const clearForm = useCallback(() => {
    setEmail('');
    setPassword('');
    setError(null);
    setResetSent(false);
    setShowPassword(false);
  }, []);

  const switchMode = useCallback((next: Mode) => {
    clearForm();
    setMode(next);
  }, [clearForm]);

  const onGoogle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      if (e instanceof GoogleSignInCancelled) { setBusy(false); return; }
      setError(e instanceof Error ? e.message : 'Could not sign in. Please try again.');
      setBusy(false);
    }
  }, []);

  const onEmailSubmit = useCallback(async () => {
    if (!email.trim() || (!password && mode !== 'reset')) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
      } else if (mode === 'signup') {
        await signUpWithEmail(email.trim(), password);
      } else if (mode === 'reset') {
        await sendPasswordReset(email.trim());
        setResetSent(true);
        setBusy(false);
      }
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(false);
    }
  }, [mode, email, password]);

  const fg = theme.colors.text;
  const muted = theme.colors.textMuted;
  const faint = theme.colors.textFaint;
  const accent = theme.colors.accent;
  const border = theme.colors.border;
  const surface = theme.colors.surface;

  const inputStyle = [
    styles.input,
    { backgroundColor: surface, borderColor: border, color: fg },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.inner, { paddingTop: insets.top + theme.spacing(10), paddingBottom: insets.bottom + theme.spacing(8) }]}>
        <View style={styles.hero}>
          <Animated.View style={[styles.logo, { backgroundColor: accent, opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
            <Icon name="send" size={44} color={theme.colors.accentText} />
          </Animated.View>
          <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentSlide }] }}>
            <Text style={[styles.appName, { color: fg }]}>Flyer</Text>
            <Text style={[styles.tagline, { color: muted }]}>Messages, voice notes and calls that keep up with you.</Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.footer, { opacity: contentOpacity, transform: [{ translateY: contentSlide }] }]}>
          {error ? (
            <Text style={[styles.errorText, { color: theme.colors.danger }]}>{error}</Text>
          ) : null}

          {mode === 'landing' && (
            <>
              <Pressable
                onPress={onGoogle}
                disabled={busy}
                haptic
                accessibilityLabel="Continue with Google"
                accessibilityState={{ busy, disabled: busy }}
                style={[styles.button, { backgroundColor: accent, borderRadius: theme.radius.pill, opacity: busy ? 0.7 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={[styles.buttonLabel, { color: theme.colors.accentText }]}>Continue with Google</Text>
                )}
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: border }]} />
                <Text style={[styles.dividerText, { color: faint }]}>or</Text>
                <View style={[styles.dividerLine, { backgroundColor: border }]} />
              </View>

              <Pressable
                onPress={() => switchMode('signin')}
                style={[styles.button, styles.buttonOutline, { borderColor: border, borderRadius: theme.radius.pill }]}
              >
                <Text style={[styles.buttonLabel, { color: fg }]}>Sign in with email</Text>
              </Pressable>

              <Pressable onPress={() => switchMode('signup')} style={styles.linkRow}>
                <Text style={[styles.linkText, { color: muted }]}>
                  Don't have an account?{' '}
                  <Text style={{ color: accent, fontWeight: '600' }}>Sign up</Text>
                </Text>
              </Pressable>
            </>
          )}

          {(mode === 'signin' || mode === 'signup') && (
            <>
              <TextInput
                style={inputStyle}
                placeholder="Email"
                placeholderTextColor={faint}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                editable={!busy}
              />
              <View style={styles.passwordRow}>
                <TextInput
                  style={[inputStyle, styles.passwordInput]}
                  placeholder="Password"
                  placeholderTextColor={faint}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  returnKeyType="done"
                  onSubmitEditing={onEmailSubmit}
                  editable={!busy}
                />
                <Pressable
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword((v) => !v)}
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  accessibilityState={{ checked: showPassword }}
                >
                  <Icon name={showPassword ? 'eye' : 'eyeOff'} size={20} color={faint} />
                </Pressable>
              </View>

              <Pressable
                onPress={onEmailSubmit}
                disabled={busy || !email.trim() || !password}
                haptic
                // Explicit label: while busy the child is a spinner, so there is
                // no text for a screen reader to fall back on.
                accessibilityLabel={mode === 'signup' ? 'Create account' : 'Sign in'}
                accessibilityState={{ busy, disabled: busy || !email.trim() || !password }}
                style={[styles.button, { backgroundColor: accent, borderRadius: theme.radius.pill, opacity: (busy || !email.trim() || !password) ? 0.6 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={[styles.buttonLabel, { color: theme.colors.accentText }]}>
                    {mode === 'signup' ? 'Create account' : 'Sign in'}
                  </Text>
                )}
              </Pressable>

              {mode === 'signin' ? (
                <Pressable onPress={() => switchMode('reset')} style={styles.linkRow}>
                  <Text style={[styles.linkText, { color: accent }]}>Forgot password?</Text>
                </Pressable>
              ) : null}

              <Pressable onPress={() => switchMode('landing')} style={styles.linkRow}>
                <Text style={[styles.linkText, { color: muted }]}>
                  <Text style={{ color: accent }}>← </Text>Back
                </Text>
              </Pressable>
            </>
          )}

          {mode === 'reset' && (
            <>
              {resetSent ? (
                <Text style={[styles.resetSent, { color: theme.colors.success }]}>
                  If that address has an account, a reset link is on its way.
                </Text>
              ) : (
                <>
                  <Text style={[styles.resetHint, { color: muted }]}>
                    Enter your email and we'll send a reset link.
                  </Text>
                  <TextInput
                    style={inputStyle}
                    placeholder="Email"
                    placeholderTextColor={faint}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    returnKeyType="done"
                    onSubmitEditing={onEmailSubmit}
                    editable={!busy}
                  />
                  <Pressable
                    onPress={onEmailSubmit}
                    disabled={busy || !email.trim()}
                    haptic
                    accessibilityLabel="Send reset link"
                    accessibilityState={{ busy, disabled: busy || !email.trim() }}
                    style={[styles.button, { backgroundColor: accent, borderRadius: theme.radius.pill, opacity: (busy || !email.trim()) ? 0.6 : 1 }]}
                  >
                    {busy ? (
                      <ActivityIndicator color={theme.colors.accentText} />
                    ) : (
                      <Text style={[styles.buttonLabel, { color: theme.colors.accentText }]}>Send reset link</Text>
                    )}
                  </Pressable>
                </>
              )}
              <Pressable onPress={() => switchMode('signin')} style={styles.linkRow}>
                <Text style={[styles.linkText, { color: muted }]}>
                  <Text style={{ color: accent }}>← </Text>Back to sign in
                </Text>
              </Pressable>
            </>
          )}

          <Text style={[styles.privacy, { color: faint }]}>
            Flyer uses your account for sign-in only.
          </Text>
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  appName: { fontSize: 40, fontWeight: '700', textAlign: 'center', letterSpacing: 0.5 },
  tagline: { fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  footer: { gap: 12 },
  errorText: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  button: { height: 54, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  buttonOutline: { borderWidth: 1 },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13 },
  linkRow: { alignItems: 'center', paddingVertical: 4 },
  linkText: { fontSize: 14 },
  input: { height: 50, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 15 },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 4 },
  resetHint: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  resetSent: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  privacy: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
