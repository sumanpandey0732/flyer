import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { UserProfile } from '@/src/config/types';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Avatar } from '@/src/components/Avatar';
import { Icon } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';
import { alertError } from '@/src/components/Confirm';
import { ensureChat, fetchAllUsers } from '@/src/services/ChatEngine';
import { useAppStore } from '@/src/services/StateManager';

export default function ContactsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const myUid = useAppStore((s) => s.currentUser?.uid) ?? null;
  const blocked = useAppStore((s) => s.blocked);
  const cacheUsers = useAppStore((s) => s.cacheUsers);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!myUid) return;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const list = await fetchAllUsers(myUid);
        setUsers(list);
        cacheUsers(list);
      } catch (e) {
        console.warn('[Flyer/contacts] load failed', e);
        alertError('Could not load contacts', 'Check your connection and pull to refresh.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [myUid, cacheUsers]
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q)
    );
  }, [users, term]);

  const openChat = useCallback(
    async (peer: UserProfile) => {
      if (!myUid || opening) return;
      setOpening(peer.uid);
      try {
        const chatId = await ensureChat(myUid, peer.uid);
        router.replace(`/chat/${chatId}`);
      } catch (e) {
        console.warn('[Flyer/contacts] could not open chat', e);
        alertError('Could not open chat', 'Please try again.');
      } finally {
        setOpening(null);
      }
    },
    [myUid, opening, router]
  );

  const closeSearch = useCallback(() => {
    setSearching(false);
    setTerm('');
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: UserProfile }) => {
      const isBlocked = blocked[item.uid] === true;
      const showPresence = item.privacy?.showLastSeen !== false;

      return (
        <Pressable
          onPress={() => void openChat(item)}
          accessibilityRole="button"
          accessibilityLabel={`Message ${item.name}`}
          style={[styles.row, { borderBottomColor: theme.colors.border }]}
        >
          <View style={isBlocked ? styles.mutedAvatar : undefined}>
            <Avatar
              uri={item.photoURL}
              name={item.name ?? ''}
              uid={item.uid}
              size={48}
              online={showPresence && item.online === true}
              showPhoto={item.privacy?.showPhoto !== false}
            />
          </View>

          <View style={styles.rowText}>
            <Text
              style={[
                styles.name,
                { color: isBlocked ? theme.colors.textMuted : theme.colors.text },
              ]}
              numberOfLines={1}
            >
              {item.name ?? 'Flyer user'}
            </Text>
            <Text style={[styles.about, { color: theme.colors.textMuted }]} numberOfLines={1}>
              {item.privacy?.showAbout === false ? '' : (item.about ?? '')}
            </Text>
          </View>

          {isBlocked ? (
            <View style={[styles.badge, { backgroundColor: theme.colors.surfaceAlt }]}>
              <Text style={[styles.badgeText, { color: theme.colors.textMuted }]}>Blocked</Text>
            </View>
          ) : null}

          {opening === item.uid ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : null}
        </Pressable>
      );
    },
    [blocked, theme, openChat, opening]
  );

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

        {searching ? (
          <TextInput
            value={term}
            onChangeText={setTerm}
            autoFocus
            placeholder="Search name or email"
            placeholderTextColor="rgba(255,255,255,0.6)"
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search contacts"
          />
        ) : (
          <Text style={styles.headerTitle} numberOfLines={1}>
            Select contact
          </Text>
        )}

        <Pressable
          round={40}
          onPress={() => (searching ? closeSearch() : setSearching(true))}
          accessibilityRole="button"
          accessibilityLabel={searching ? 'Close search' : 'Search contacts'}
        >
          <Icon name={searching ? 'close' : 'search'} size={searching ? 20 : 26} color="#FFFFFF" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.uid}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
            />
          }
          ListHeaderComponent={
            <Text style={[styles.sectionHeader, { color: theme.colors.textMuted }]}>
              {filtered.length === 1 ? '1 contact' : `${filtered.length} contacts`}
              {term.trim() ? ` matching “${term.trim()}”` : ' on Flyer'}
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="people" size={44} color={theme.colors.textFaint} />
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                {term.trim() ? 'No matches' : 'No contacts yet'}
              </Text>
              <Text style={[styles.emptyBody, { color: theme.colors.textMuted }]}>
                {term.trim()
                  ? 'Try a different name or email address.'
                  : 'People show up here once they sign in to Flyer.'}
              </Text>
            </View>
          }
        />
      )}
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
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 19, fontWeight: '600', marginLeft: 4 },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    paddingVertical: 6,
    marginLeft: 4,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mutedAvatar: { opacity: 0.5 },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '500' },
  about: { fontSize: 13, marginTop: 3 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
