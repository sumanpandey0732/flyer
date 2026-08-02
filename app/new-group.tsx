import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GROUP_MAX_MEMBERS, GROUP_NAME_MAX } from '@/src/config/types';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Avatar } from '@/src/components/Avatar';
import { Icon } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';
import { EmptyState } from '@/src/components/EmptyState';
import { ActionSheet, type SheetAction } from '@/src/components/ActionSheet';
import { alertError } from '@/src/components/Confirm';
import { createGroup } from '@/src/services/GroupService';
import { captureWithCamera, pickFromLibrary, uploadToCloudinary } from '@/src/services/MediaManager';
import { useAppStore } from '@/src/services/StateManager';

/**
 * New group — two steps in one screen, the way WhatsApp splits it.
 *
 * Step 1 picks members from contacts, step 2 names the group. They are separate
 * because the member list is long enough to need the whole screen, and a name
 * field above it would scroll away exactly when you want to confirm it.
 */
export default function NewGroupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const myUid = useAppStore((s) => s.currentUser?.uid) ?? null;
  const contacts = useAppStore((s) => s.contacts);
  const users = useAppStore((s) => s.users);

  const [step, setStep] = useState<'members' | 'details'>('members');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [name, setName] = useState('');
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    const list = contacts
      .map((c) => ({ uid: c.uid, profile: users[c.uid] ?? null }))
      .sort((a, b) => (a.profile?.name ?? '~').localeCompare(b.profile?.name ?? '~'));
    if (!q) return list;
    const handle = q.replace(/^@/, '');
    return list.filter(
      (r) =>
        (r.profile?.name ?? '').toLowerCase().includes(q) ||
        (r.profile?.username ?? '').toLowerCase().includes(handle) ||
        (r.profile?.email ?? '').toLowerCase().includes(q)
    );
  }, [contacts, users, term]);

  const toggle = useCallback(
    (uid: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(uid)) {
          next.delete(uid);
          return next;
        }
        // The cap counts the creator, who is not in this set.
        if (next.size + 1 >= GROUP_MAX_MEMBERS) {
          alertError('Group is full', `A group can hold ${GROUP_MAX_MEMBERS} people.`);
          return prev;
        }
        next.add(uid);
        return next;
      });
    },
    []
  );

  const pickPhoto = useCallback(async (source: 'camera' | 'library') => {
    if (uploading) return;
    try {
      const picked =
        source === 'camera'
          ? await captureWithCamera('image')
          : (await pickFromLibrary('image'))[0];
      if (!picked) return;
      setUploading(true);
      const uploaded = await uploadToCloudinary(picked.uri, 'image');
      setPhotoURL(uploaded.url);
    } catch (e) {
      console.warn('[Flyer/new-group] photo failed', e);
      alertError('Could not set the photo', e instanceof Error ? e.message : undefined);
    } finally {
      setUploading(false);
    }
  }, [uploading]);

  const photoActions = useMemo<SheetAction[]>(() => {
    const list: SheetAction[] = [
      { key: 'camera', label: 'Take photo', icon: 'camera', onPress: () => void pickPhoto('camera') },
      {
        key: 'library',
        label: 'Choose from gallery',
        icon: 'attach',
        onPress: () => void pickPhoto('library'),
      },
    ];
    if (photoURL) {
      list.push({
        key: 'remove',
        label: 'Remove photo',
        icon: 'trash',
        destructive: true,
        onPress: () => setPhotoURL(null),
      });
    }
    return list;
  }, [photoURL, pickPhoto]);

  const submit = useCallback(async () => {
    if (!myUid || creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      alertError('Name required', 'Give the group a name so people know what it is.');
      return;
    }
    setCreating(true);
    try {
      const chatId = await createGroup(myUid, trimmed, [...selected], photoURL);
      // `replace`, not `push`: backing out of a new group should land on the
      // chat list, not on the picker that created it.
      router.replace(`/chat/${chatId}`);
    } catch (e) {
      console.warn('[Flyer/new-group] create failed', e);
      alertError('Could not create the group', e instanceof Error ? e.message : undefined);
      setCreating(false);
    }
  }, [myUid, creating, name, selected, photoURL, router]);

  const back = useCallback(() => {
    if (step === 'details') setStep('members');
    else router.back();
  }, [step, router]);

  const selectedProfiles = useMemo(
    () => [...selected].map((uid) => ({ uid, profile: users[uid] ?? null })),
    [selected, users]
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.header, paddingTop: insets.top + 8 },
        ]}
      >
        <Pressable round={40} onPress={back} accessibilityLabel="Go back">
          <Icon name="back" size={30} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {step === 'members' ? 'New group' : 'Group details'}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {step === 'members'
              ? selected.size === 0
                ? 'Add participants'
                : `${selected.size} selected`
              : `${selected.size + 1} participants`}
          </Text>
        </View>
      </View>

      {step === 'members' ? (
        <>
          <View style={[styles.searchWrap, { borderBottomColor: theme.colors.border }]}>
            <Icon name="search" size={18} color={theme.colors.textMuted} />
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder="Search contacts"
              placeholderTextColor={theme.colors.textFaint}
              style={[styles.searchInput, { color: theme.colors.text }]}
              autoCorrect={false}
              accessibilityLabel="Search contacts"
            />
          </View>

          {selected.size > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[styles.chipsScroll, { borderBottomColor: theme.colors.border }]}
              contentContainerStyle={styles.chips}
            >
              {selectedProfiles.map(({ uid, profile }) => (
                <Pressable
                  key={uid}
                  onPress={() => toggle(uid)}
                  style={styles.chip}
                  accessibilityLabel={`Remove ${profile?.name ?? 'contact'} from the group`}
                >
                  <View>
                    <Avatar
                      uri={profile?.photoURL ?? null}
                      name={profile?.name ?? '?'}
                      uid={uid}
                      size={52}
                    />
                    <View style={[styles.chipRemove, { backgroundColor: theme.colors.textMuted }]}>
                      <Icon name="close" size={12} color={theme.colors.bg} />
                    </View>
                  </View>
                  <Text
                    style={[styles.chipName, { color: theme.colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {profile?.name?.split(' ')[0] ?? 'Unknown'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <FlatList
            data={rows}
            keyExtractor={(item) => item.uid}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
            renderItem={({ item }) => {
              const checked = selected.has(item.uid);
              const label = item.profile?.name ?? 'Unknown';
              return (
                <Pressable
                  onPress={() => toggle(item.uid)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={label}
                  style={styles.row}
                >
                  <Avatar
                    uri={item.profile?.photoURL ?? null}
                    name={label}
                    uid={item.uid}
                    size={48}
                    showPhoto={item.profile?.privacy?.showPhoto !== false}
                  />
                  <View style={[styles.rowText, { borderBottomColor: theme.colors.border }]}>
                    <Text style={[styles.rowName, { color: theme.colors.text }]} numberOfLines={1}>
                      {label}
                    </Text>
                    {item.profile?.about ? (
                      <Text
                        style={[styles.rowAbout, { color: theme.colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {item.profile.about}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: checked ? theme.colors.accent : theme.colors.border,
                        backgroundColor: checked ? theme.colors.accent : 'transparent',
                      },
                    ]}
                  >
                    {checked ? (
                      <Icon name="accept" size={14} color={theme.colors.accentText} />
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon="people"
                title={term ? 'No matches' : 'No contacts yet'}
                body={
                  term
                    ? `Nothing found for "${term}".`
                    : 'Add contacts first — a group is built from people you already know.'
                }
              />
            }
          />

          {selected.size > 0 ? (
            <Pressable
              style={[
                styles.fab,
                { backgroundColor: theme.colors.accent, bottom: insets.bottom + 24 },
              ]}
              haptic
              onPress={() => setStep('details')}
              accessibilityLabel="Continue to group details"
            >
              <Icon name="chevron" size={26} color={theme.colors.accentText} />
            </Pressable>
          ) : null}
        </>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        >
          <View style={styles.detailsTop}>
            <Pressable
              onPress={() => setPhotoSheet(true)}
              accessibilityLabel="Set group photo"
              style={styles.photoWrap}
            >
              <Avatar uri={photoURL} name={name || 'Group'} uid="new-group" size={78} group />
              <View style={[styles.photoBadge, { backgroundColor: theme.colors.accent }]}>
                {uploading ? (
                  <ActivityIndicator size="small" color={theme.colors.accentText} />
                ) : (
                  <Icon name="camera" size={16} color={theme.colors.accentText} />
                )}
              </View>
            </Pressable>

            <View style={styles.nameWrap}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Group name"
                placeholderTextColor={theme.colors.textFaint}
                maxLength={GROUP_NAME_MAX}
                autoFocus
                style={[
                  styles.nameInput,
                  { color: theme.colors.text, borderBottomColor: theme.colors.accent },
                ]}
                accessibilityLabel="Group name"
              />
              <Text style={[styles.counter, { color: theme.colors.textFaint }]}>
                {GROUP_NAME_MAX - name.length}
              </Text>
            </View>
          </View>

          <Text style={[styles.sectionHeader, { color: theme.colors.accent }]}>
            Participants: {selected.size + 1}
          </Text>

          {selectedProfiles.map(({ uid, profile }) => (
            <View key={uid} style={styles.row}>
              <Avatar
                uri={profile?.photoURL ?? null}
                name={profile?.name ?? 'Unknown'}
                uid={uid}
                size={44}
              />
              <View style={[styles.rowText, { borderBottomColor: theme.colors.border }]}>
                <Text style={[styles.rowName, { color: theme.colors.text }]} numberOfLines={1}>
                  {profile?.name ?? 'Unknown'}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {step === 'details' ? (
        <Pressable
          style={[
            styles.fab,
            {
              backgroundColor: name.trim() ? theme.colors.accent : theme.colors.surfaceAlt,
              bottom: insets.bottom + 24,
            },
          ]}
          haptic
          onPress={() => void submit()}
          accessibilityLabel="Create group"
        >
          {creating ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Icon name="accept" size={26} color={theme.colors.accentText} />
          )}
        </Pressable>
      ) : null}

      <ActionSheet
        visible={photoSheet}
        title="Group photo"
        actions={photoActions}
        onClose={() => setPhotoSheet(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingBottom: 10,
  },
  headerText: { flex: 1, marginLeft: 4 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  headerSubtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5, marginTop: 1 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15.5, padding: 0 },

  chipsScroll: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  chips: { flexDirection: 'row', gap: 14, paddingHorizontal: 14, paddingVertical: 12 },
  chip: { alignItems: 'center', width: 60 },
  chipRemove: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipName: { fontSize: 11.5, marginTop: 5 },

  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, minHeight: 66 },
  rowText: {
    flex: 1,
    marginLeft: 13,
    paddingRight: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowName: { fontSize: 16, fontWeight: '500' },
  rowAbout: { fontSize: 13, marginTop: 2 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },

  detailsTop: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 16 },
  photoWrap: { width: 78, height: 78 },
  photoBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  nameInput: { flex: 1, fontSize: 17, paddingVertical: 8, borderBottomWidth: 2 },
  counter: { fontSize: 12, paddingBottom: 10 },

  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
  },
});
