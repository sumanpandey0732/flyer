import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Avatar } from '@/src/components/Avatar';
import { Icon } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';
import { ListRow } from '@/src/components/ListRow';
import { ActionSheet, type SheetAction } from '@/src/components/ActionSheet';
import { alertError, confirm } from '@/src/components/Confirm';
import { Paths, update } from '@/src/services/FirebaseService';
import {
  captureWithCamera,
  pickFromLibrary,
  transformed,
  uploadToCloudinary,
} from '@/src/services/MediaManager';
import { deleteAccount, signOut } from '@/src/services/AuthManager';
import { getToken, unregisterToken } from '@/src/services/NotificationManager';
import { useAppStore } from '@/src/services/StateManager';
import {
  UsernameError,
  isUsernameAvailable,
  normaliseUsername,
  setUsername,
  validateUsername,
} from '@/src/services/UsernameService';

const NAME_MAX = 40;
const ABOUT_MAX = 140;
const USERNAME_MAX = 24;

type EditField = 'name' | 'about' | 'username';

/** Result of the live availability probe shown under the username field. */
type HandleCheck =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'taken' }
  | { kind: 'free' };

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
  const [handleCheck, setHandleCheck] = useState<HandleCheck>({ kind: 'idle' });
  const [photoSheet, setPhotoSheet] = useState(false);
  const [photoViewer, setPhotoViewer] = useState(false);

  const uid = me?.uid ?? null;

  const beginEdit = useCallback(
    (field: EditField) => {
      if (!me) return;
      setDraft(
        field === 'name'
          ? (me.name ?? '')
          : field === 'about'
            ? (me.about ?? '')
            : (me.username ?? '')
      );
      setHandleCheck({ kind: 'idle' });
      setEditing(field);
    },
    [me]
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft('');
    setHandleCheck({ kind: 'idle' });
  }, []);

  // Availability is advisory — the write still races — but showing "taken"
  // before the user commits is the difference between a form and a guess.
  useEffect(() => {
    if (editing !== 'username' || !uid) return;

    const handle = normaliseUsername(draft);
    if (handle === (me?.username ?? '')) {
      setHandleCheck({ kind: 'idle' });
      return;
    }

    const invalid = validateUsername(handle);
    if (invalid) {
      setHandleCheck(handle ? { kind: 'invalid', reason: invalid } : { kind: 'idle' });
      return;
    }

    let cancelled = false;
    setHandleCheck({ kind: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const free = await isUsernameAvailable(handle, uid);
        if (!cancelled) setHandleCheck(free ? { kind: 'free' } : { kind: 'taken' });
      } catch {
        // Offline: stay quiet rather than claim it is free.
        if (!cancelled) setHandleCheck({ kind: 'idle' });
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, editing, uid, me?.username]);

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
      if (editing === 'username') {
        // Goes through UsernameService, not a plain update: claiming a handle
        // also has to release the old one and update the uniqueness index, and
        // the rules reject the profile field on its own.
        await setUsername(uid, trimmed);
      } else {
        const patch = editing === 'name' ? { name: trimmed } : { about: trimmed };
        await update(Paths.user(uid), patch);
        patchCurrentUser(patch);
      }
      setEditing(null);
      setDraft('');
      setHandleCheck({ kind: 'idle' });
    } catch (e) {
      if (e instanceof UsernameError) {
        alertError('Could not set username', e.message);
      } else {
        console.warn('[Flyer/profile] save failed', e);
        alertError('Could not save', 'Check your connection and try again.');
      }
    } finally {
      setSaving(false);
    }
  }, [uid, editing, draft, patchCurrentUser]);

  const changePhoto = useCallback(
    async (source: 'camera' | 'library') => {
      if (!uid || uploadProgress !== null) return;
      try {
        const picked =
          source === 'camera'
            ? await captureWithCamera('image')
            : (await pickFromLibrary('image'))[0];
        if (!picked) return;

        setUploadProgress(0);
        const uploaded = await uploadToCloudinary(picked.uri, 'image', (fraction) =>
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
    },
    [uid, uploadProgress, patchCurrentUser]
  );

  const removePhoto = useCallback(async () => {
    if (!uid || uploadProgress !== null) return;

    const ok = await confirm({
      title: 'Remove profile photo?',
      message: 'Your contacts will see your initials instead.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    try {
      // Written as null, not deleted: `update` with an absent key leaves the old
      // value in place, and every reader already treats null as "no photo".
      await update(Paths.user(uid), { photoURL: null });
      patchCurrentUser({ photoURL: null });
    } catch (e) {
      console.warn('[Flyer/profile] photo remove failed', e);
      alertError('Could not remove photo', 'Check your connection and try again.');
    }
  }, [uid, uploadProgress, patchCurrentUser]);

  /**
   * Tapping the avatar opens a sheet rather than the picker directly: with a
   * photo set, viewing it is the more common intent than replacing it.
   */
  const photoActions: SheetAction[] = useMemo(() => {
    const list: SheetAction[] = [];
    if (me?.photoURL) {
      list.push({
        key: 'view',
        label: 'View photo',
        icon: 'people',
        onPress: () => setPhotoViewer(true),
      });
    }
    list.push(
      {
        key: 'camera',
        label: 'Take photo',
        icon: 'camera',
        onPress: () => void changePhoto('camera'),
      },
      {
        key: 'library',
        label: 'Choose from gallery',
        icon: 'attach',
        onPress: () => void changePhoto('library'),
      }
    );
    if (me?.photoURL) {
      list.push({
        key: 'remove',
        label: 'Remove photo',
        icon: 'trash',
        destructive: true,
        onPress: () => void removePhoto(),
      });
    }
    return list;
  }, [me?.photoURL, changePhoto, removePhoto]);

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
        'This removes your profile, contacts, starred messages and call history. ' +
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
    const max =
      field === 'name' ? NAME_MAX : field === 'about' ? ABOUT_MAX : USERNAME_MAX;
    const isHandle = field === 'username';
    // A handle that is invalid or already taken cannot be saved, so the button
    // is disabled rather than letting the write fail with an alert.
    const blocked =
      isHandle && (handleCheck.kind === 'invalid' || handleCheck.kind === 'taken');

    return (
      <View style={[styles.block, { borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.blockLabel, { color: theme.colors.accent }]}>{label}</Text>

        {isEditing ? (
          <View>
            <View style={styles.handleRow}>
              {isHandle ? (
                <Text style={[styles.at, { color: theme.colors.textMuted }]}>@</Text>
              ) : null}
              <TextInput
                value={draft}
                onChangeText={isHandle ? (v) => setDraft(normaliseUsername(v)) : setDraft}
                autoFocus
                maxLength={max}
                multiline={field === 'about'}
                autoCapitalize={isHandle ? 'none' : 'sentences'}
                autoCorrect={!isHandle}
                placeholder={hint}
                placeholderTextColor={theme.colors.textFaint}
                accessibilityLabel={`Edit ${label}`}
                style={[
                  styles.input,
                  isHandle && styles.handleInput,
                  { color: theme.colors.text, borderBottomColor: theme.colors.accent },
                ]}
              />
            </View>

            {isHandle ? <HandleHint check={handleCheck} /> : null}

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
                disabled={saving || blocked}
                accessibilityRole="button"
                accessibilityLabel={`Save ${label}`}
                accessibilityState={{ disabled: saving || blocked }}
                style={styles.editButton}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                ) : (
                  <Text
                    style={[
                      styles.editButtonLabel,
                      { color: blocked ? theme.colors.textFaint : theme.colors.accent },
                    ]}
                  >
                    Save
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.blockRow}>
            <Text style={[styles.blockValue, { color: theme.colors.text }]}>
              {value ? (isHandle ? `@${value}` : value) : hint}
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
            onPress={() => setPhotoSheet(true)}
            disabled={uploadProgress !== null}
            accessibilityRole="button"
            accessibilityLabel="Profile photo"
            style={styles.avatarPress}
          >
            <Avatar uri={me.photoURL} name={me.name ?? ''} uid={me.uid} size={148} showPhoto />

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
        {renderEditable(
          'username',
          'Username',
          me.username ?? '',
          'Pick a username so people can find you'
        )}
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

      <ActionSheet
        visible={photoSheet}
        title="Profile photo"
        actions={photoActions}
        onClose={() => setPhotoSheet(false)}
      />

      <Modal
        visible={photoViewer}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setPhotoViewer(false)}
        statusBarTranslucent
      >
        <StatusBar barStyle="light-content" />
        <View style={styles.viewer}>
          <View style={[styles.viewerHeader, { paddingTop: insets.top + 6 }]}>
            <Pressable
              onPress={() => setPhotoViewer(false)}
              round={42}
              accessibilityLabel="Close photo"
            >
              <Icon name="close" size={20} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.viewerTitle}>{me?.name ?? 'Profile photo'}</Text>
          </View>

          {me?.photoURL ? (
            <Image
              source={{ uri: transformed(me.photoURL, { width: 1200 }) }}
              style={styles.viewerImage}
              contentFit="contain"
              transition={200}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

/** The one line under the username field that says whether it can be saved. */
function HandleHint({ check }: { check: HandleCheck }) {
  const theme = useTheme();

  if (check.kind === 'idle') {
    return (
      <Text style={[styles.hint, { color: theme.colors.textFaint }]}>
        Letters, numbers, dots and underscores. 3–24 characters.
      </Text>
    );
  }

  if (check.kind === 'checking') {
    return (
      <Text style={[styles.hint, { color: theme.colors.textFaint }]}>Checking…</Text>
    );
  }

  if (check.kind === 'invalid') {
    return <Text style={[styles.hint, { color: theme.colors.danger }]}>{check.reason}</Text>;
  }

  if (check.kind === 'taken') {
    return (
      <Text style={[styles.hint, { color: theme.colors.danger }]}>
        That username is taken.
      </Text>
    );
  }

  return (
    <Text style={[styles.hint, { color: theme.colors.success }]}>Available</Text>
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
  handleRow: { flexDirection: 'row', alignItems: 'flex-end' },
  at: { fontSize: 17, paddingBottom: 8, paddingRight: 2 },
  handleInput: { flex: 1 },
  hint: { fontSize: 12.5, marginTop: 6 },
  input: {
    fontSize: 16,
    paddingVertical: 8,
    marginTop: 6,
    borderBottomWidth: 1.5,
    maxHeight: 120,
  },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 10 },

  // Always black, never themed: light chrome behind a photo washes it out, and
  // both platforms' native viewers do the same.
  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  viewerTitle: { color: '#FFFFFF', fontSize: 16.5, fontWeight: '600', marginLeft: 4 },
  viewerImage: { flex: 1, width: '100%' },  counter: { flex: 1, fontSize: 12 },
  editButton: { paddingVertical: 6, paddingHorizontal: 4, minWidth: 54, alignItems: 'center' },
  editButtonLabel: { fontSize: 15, fontWeight: '600' },
  actions: { marginTop: 24 },
});
