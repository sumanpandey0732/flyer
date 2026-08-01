import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Avatar } from '@/src/components/Avatar';
import { Icon } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';
import { ListRow } from '@/src/components/ListRow';
import { alertError, confirm } from '@/src/components/Confirm';
import { Paths, update } from '@/src/services/FirebaseService';
import { pickFromLibrary, uploadToCloudinary } from '@/src/services/MediaManager';
import { deleteAccount, signOut } from '@/src/services/AuthManager';
import { getToken, unregisterToken } from '@/src/services/NotificationManager';
import { useAppStore } from '@/src/services/StateManager';

const NAME_MAX = 40;
const ABOUT_MAX = 140;

type EditField = 'name' | 'about';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const me = useAppStore((s) => s.currentUser);
  const patchCurrentUser = useAppStore((s) => s.patchCurrentUser);

  const [editing, setEditing] = useState<EditField | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const uid = me?.uid ?? null;

  const beginEdit = useCallback(
    (field: EditField) => {
      if (!me) return;
      setDraft(field === 'name' ? (me.name ?? '') : (me.about ?? ''));
      setEditing(field);
    },
    [me]
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!uid || !editing) return;
    const trimmed = draft.trim();

    // A blank display name would break the chat list and is rejected by rules.
    if (editing === 'name' && !trimmed) {
      alertError('Name required', 'Your name cannot be empty.');
      return;
    }

    setSaving(true);
    try {
      const patch = editing === 'name' ? { name: trimmed } : { about: trimmed };
      await update(Paths.user(uid), patch);
      patchCurrentUser(patch);
      setEditing(null);
      setDraft('');
    } catch (e) {
      console.warn('[Flyer/profile] save failed', e);
      alertError('Could not save', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [uid, editing, draft, patchCurrentUser]);

  const changePhoto = useCallback(async () => {
    if (!uid || uploadProgress !== null) return;
    try {
      const picked = await pickFromLibrary('image');
      const first = picked[0];
      if (!first) return;

      setUploadProgress(0);
      const uploaded = await uploadToCloudinary(first.uri, 'image', (fraction) =>
        setUploadProgress(fraction)
      );

      await update(Paths.user(uid), { photoURL: uploaded.url });
      patchCurrentUser({ photoURL: uploaded.url });
    } catch (e) {
      console.warn('[Flyer/profile] photo update failed', e);
      alertError('Could not update photo', e instanceof Error ? e.message : undefined);
    } finally {
      setUploadProgress(null);
    }
  }, [uid, uploadProgress, patchCurrentUser]);

  const onSignOut = useCallback(async () => {
    if (!uid || signingOut) return;
    const ok = await confirm({
      title: 'Sign out of Flyer?',
      message: 'You will stop receiving messages and calls on this device.',
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (!ok) return;

    setSigningOut(true);
    try {
      // Capture the token before unregistering — unregisterToken clears it.
      const token = getToken();
      await unregisterToken(uid);
      await signOut(uid, token);
      // The root layout reacts to the auth change and swaps to the login stack.
    } catch (e) {
      console.warn('[Flyer/profile] sign out failed', e);
      alertError('Could not sign out', 'Please try again.');
      setSigningOut(false);
    }
  }, [uid, signingOut]);

  const onDeleteAccount = useCallback(async () => {
    if (!uid) return;

    const first = await confirm({
      title: 'Delete your account?',
      message:
        'This removes your profile, starred messages, status posts and call history. ' +
        'Messages you have already sent stay in other people’s chats.',
      confirmLabel: 'Continue',
      destructive: true,
    });
    if (!first) return;

    const second = await confirm({
      title: 'This cannot be undone',
      message: 'Delete your Flyer account permanently?',
      confirmLabel: 'Delete account',
      destructive: true,
    });
    if (!second) return;

    try {
      await deleteAccount(uid);
    } catch (e) {
      console.warn('[Flyer/profile] delete failed', e);
      alertError(
        'Could not delete account',
        'Sign out and sign back in, then try again — Firebase requires a recent login for this.'
      );
    }
  }, [uid]);

  if (!me) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: theme.colors.bg }]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const memberSince = me.createdAt
    ? new Date(me.createdAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'Unknown';

  const renderEditable = (field: EditField, label: string, value: string, hint: string) => {
    const isEditing = editing === field;
    const max = field === 'name' ? NAME_MAX : ABOUT_MAX;

    return (
      <View style={[styles.block, { borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.blockLabel, { color: theme.colors.accent }]}>{label}</Text>

        {isEditing ? (
          <View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              maxLength={max}
              multiline={field === 'about'}
              placeholder={hint}
              placeholderTextColor={theme.colors.textFaint}
              accessibilityLabel={`Edit ${label}`}
              style={[
                styles.input,
                { color: theme.colors.text, borderBottomColor: theme.colors.accent },
              ]}
            />
            <View style={styles.editActions}>
              <Text style={[styles.counter, { color: theme.colors.textFaint }]}>
                {draft.length}/{max}
              </Text>
              <Pressable
                onPress={cancelEdit}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={`Cancel editing ${label}`}
                style={styles.editButton}
              >
                <Text style={[styles.editButtonLabel, { color: theme.colors.textMuted }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void saveEdit()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={`Save ${label}`}
                style={styles.editButton}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                ) : (
                  <Text style={[styles.editButtonLabel, { color: theme.colors.accent }]}>
                    Save
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.blockRow}>
            <Text style={[styles.blockValue, { color: theme.colors.text }]}>
              {value || hint}
            </Text>
            <Pressable
              round={40}
              onPress={() => beginEdit(field)}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${label}`}
            >
              <Icon name="edit" size={19} color={theme.colors.accent} />
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.header, paddingTop: insets.top + 8 },
        ]}
      >
        <Pressable
          round={40}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={30} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.avatarArea}>
          <Pressable
            onPress={() => void changePhoto()}
            disabled={uploadProgress !== null}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            style={styles.avatarPress}
          >
            <Avatar uri={me.photoURL} name={me.name ?? ''} uid={me.uid} size={148} />

            {uploadProgress !== null ? (
              <View style={[styles.uploadOverlay, { backgroundColor: theme.colors.overlay }]}>
                <ActivityIndicator color="#FFFFFF" />
                <Text style={styles.uploadText}>{Math.round(uploadProgress * 100)}%</Text>
              </View>
            ) : null}

            <View
              style={[
                styles.cameraBadge,
                { backgroundColor: theme.colors.accent, borderColor: theme.colors.bg },
              ]}
            >
              <Icon name="camera" size={20} color={theme.colors.accentText} />
            </View>
          </Pressable>
        </View>

        {renderEditable('name', 'Name', me.name ?? '', 'Add your name')}
        {renderEditable('about', 'About', me.about ?? '', 'Add a few words about you')}

        <View style={[styles.block, { borderBottomColor: theme.colors.border }]}>
          <Text style={[styles.blockLabel, { color: theme.colors.accent }]}>Email</Text>
          <Text style={[styles.blockValue, { color: theme.colors.text }]}>{me.email}</Text>
          <Text style={[styles.blockHint, { color: theme.colors.textFaint }]}>
            Provided by your Google account and cannot be changed here.
          </Text>
        </View>

        <View style={[styles.block, { borderBottomColor: theme.colors.border }]}>
          <Text style={[styles.blockLabel, { color: theme.colors.accent }]}>Member since</Text>
          <Text style={[styles.blockValue, { color: theme.colors.text }]}>{memberSince}</Text>
        </View>

        <View style={styles.actions}>
          <ListRow
            icon="logout"
            title={signingOut ? 'Signing out…' : 'Sign out'}
            destructive
            onPress={signingOut ? undefined : () => void onSignOut()}
            right={
              signingOut ? <ActivityIndicator size="small" color={theme.colors.danger} /> : undefined
            }
          />
          <ListRow
            icon="trash"
            title="Delete account"
            subtitle="Permanently remove your Flyer profile and data"
            destructive
            onPress={() => void onDeleteAccount()}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingBottom: 10,
  },
  headerTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '600', marginLeft: 4 },
  avatarArea: { alignItems: 'center', paddingVertical: 30 },
  avatarPress: { borderRadius: 74 },
  uploadOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 74,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  uploadText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  block: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  blockLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  blockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8 },
  blockValue: { flex: 1, fontSize: 16, lineHeight: 22, marginTop: 8 },
  blockHint: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  input: {
    fontSize: 16,
    paddingVertical: 8,
    marginTop: 6,
    borderBottomWidth: 1.5,
    maxHeight: 120,
  },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 10 },
  counter: { flex: 1, fontSize: 12 },
  editButton: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 54, alignItems: 'center' },
  editButtonLabel: { fontSize: 15, fontWeight: '600' },
  actions: { marginTop: 24 },
});
