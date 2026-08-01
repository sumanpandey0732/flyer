import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Icon } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';
import { ChatListItem } from '@/src/components/ChatListItem';
import { SearchBar } from '@/src/components/SearchBar';
import { EmptyState } from '@/src/components/EmptyState';
import { alertError, confirm } from '@/src/components/Confirm';
import { selectSortedChats, useAppStore } from '@/src/services/StateManager';
import {
  clearChat,
  deleteChatForMe,
  isChatMuted,
  listenToUser,
  peerOf,
  searchChats,
  setChatMuted,
} from '@/src/services/ChatEngine';
import type { ChatSummary } from '@/src/config/types';
import { ActionSheet, type SheetAction } from '@/src/components/ActionSheet';

/** Mute duration offered by the long-press menu. */
const MUTE_MS = 8 * 60 * 60 * 1000;

export default function ChatsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const myUid = useAppStore((s) => s.currentUser?.uid ?? null);
  const chats = useAppStore(selectSortedChats);
  const users = useAppStore((s) => s.users);

  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatSummary | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  // The chat list listener is owned by the root layout (it must outlive this
  // screen). Here we only hydrate the peer profiles the rows render.
  const watched = useRef(new Map<string, () => void>());

  useEffect(() => {
    if (!myUid) return;
    const live = watched.current;

    for (const chat of chats) {
      const peer = peerOf(chat, myUid);
      if (peer && !live.has(peer)) {
        live.set(peer, listenToUser(peer));
      }
    }
  }, [chats, myUid]);

  // Detach every peer listener when the screen goes away, not on each change —
  // the effect above runs on every chat update and would thrash them.
  useEffect(() => {
    const live = watched.current;
    return () => {
      for (const off of live.values()) off();
      live.clear();
    };
  }, []);

  const visible = useMemo(
    () => (myUid ? searchChats(chats, users, myUid, term) : []),
    [chats, users, myUid, term]
  );

  const onRefresh = useCallback(async () => {
    if (!myUid) return;
    setRefreshing(true);
    // Re-attaching the peer listeners is what actually refreshes names, photos
    // and presence; the chat list itself is already live.
    for (const off of watched.current.values()) off();
    watched.current.clear();
    for (const chat of chats) {
      const peer = peerOf(chat, myUid);
      if (peer) watched.current.set(peer, listenToUser(peer));
    }
    setRefreshing(false);
  }, [chats, myUid]);

  const closeSearch = useCallback(() => {
    setSearching(false);
    setTerm('');
  }, []);

  const chatActions = useMemo<SheetAction[]>(() => {
    if (!menuFor || !myUid) return [];
    const muted = isChatMuted(menuFor, myUid);
    const chatId = menuFor.id;

    return [
      {
        key: 'mute',
        label: muted ? 'Unmute notifications' : 'Mute for 8 hours',
        icon: muted ? 'unmute' : 'mute',
        onPress: async () => {
          try {
            await setChatMuted(chatId, myUid, muted ? null : Date.now() + MUTE_MS);
          } catch (e) {
            alertError('Could not update notifications', String(e));
          }
        },
      },
      {
        key: 'clear',
        label: 'Clear messages',
        icon: 'trash',
        onPress: async () => {
          const ok = await confirm({
            title: 'Clear this chat?',
            message: 'Messages will be hidden for you. The other person keeps their copy.',
            confirmLabel: 'Clear',
            destructive: true,
          });
          if (!ok) return;
          try {
            await clearChat(chatId, myUid);
          } catch (e) {
            alertError('Could not clear the chat', String(e));
          }
        },
      },
      {
        key: 'delete',
        label: 'Delete chat',
        icon: 'trash',
        destructive: true,
        onPress: async () => {
          const ok = await confirm({
            title: 'Delete this chat?',
            message: 'It will be removed from your list. The other person keeps their copy.',
            confirmLabel: 'Delete',
            destructive: true,
          });
          if (!ok) return;
          try {
            await deleteChatForMe(chatId, myUid);
          } catch (e) {
            alertError('Could not delete the chat', String(e));
          }
        },
      },
    ];
  }, [menuFor, myUid]);

  const overflowActions = useMemo<SheetAction[]>(
    () => [
      {
        key: 'starred',
        label: 'Starred messages',
        icon: 'star',
        onPress: () => router.push('/starred'),
      },
      {
        key: 'profile',
        label: 'Profile',
        icon: 'people',
        onPress: () => router.push('/profile'),
      },
      {
        key: 'settings',
        label: 'Settings',
        icon: 'settings',
        onPress: () => router.push('/settings'),
      },
    ],
    []
  );

  if (!myUid) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.colors.bg }]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const noChatsAtAll = chats.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: theme.colors.header }]}>
        {searching ? (
          <SearchBar
            value={term}
            onChangeText={setTerm}
            onClose={closeSearch}
            placeholder="Search name or message"
          />
        ) : (
          <>
            <Text style={[styles.title, { color: theme.colors.text }]}>Flyer</Text>
            <View style={styles.headerActions}>
              <Pressable round={40} onPress={() => setSearching(true)} accessibilityLabel="Search">
                <Icon name="search" size={22} color={theme.colors.text} />
              </Pressable>
              <Pressable
                round={40}
                onPress={() => setOverflowOpen(true)}
                accessibilityLabel="More options"
              >
                <Icon name="more" size={22} color={theme.colors.text} />
              </Pressable>
            </View>
          </>
        )}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={visible.length === 0 ? styles.emptyContainer : undefined}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        renderItem={({ item }) => {
          const peerUid = peerOf(item, myUid);
          return (
            <ChatListItem
              chat={item}
              peer={peerUid ? (users[peerUid] ?? null) : null}
              myUid={myUid}
              muted={isChatMuted(item, myUid)}
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => setMenuFor(item)}
            />
          );
        }}
        ListEmptyComponent={
          term.length > 0 ? (
            <EmptyState
              icon="search"
              title="No matches"
              body={`Nothing found for "${term}".`}
            />
          ) : noChatsAtAll ? (
            <EmptyState
              icon="people"
              title="No chats yet"
              body="Start a conversation and it will show up here."
              actionLabel="Start a chat"
              onAction={() => router.push('/contacts')}
            />
          ) : null
        }
      />

      <Pressable
        style={[
          styles.fab,
          { backgroundColor: theme.colors.accent, bottom: 24 },
        ]}
        haptic
        onPress={() => router.push('/contacts')}
        accessibilityLabel="New chat"
      >
        <Icon name="plus" size={26} color={theme.colors.accentText} />
      </Pressable>

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? (users[peerOf(menuFor, myUid) ?? '']?.name ?? 'Chat') : ''}
        actions={chatActions}
        onClose={() => setMenuFor(null)}
      />

      <ActionSheet
        visible={overflowOpen}
        actions={overflowActions}
        onClose={() => setOverflowOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 56,
  },
  title: { fontSize: 22, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
