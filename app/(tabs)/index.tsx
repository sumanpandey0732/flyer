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
import { SwipeableChatRow } from '@/src/components/SwipeableChatRow';
import {
  selectArchivedUnread,
  selectSortedChats,
  useAppStore,
} from '@/src/services/StateManager';
import {
  clearChat,
  deleteChatForMe,
  isChatMuted,
  listenToUser,
  markChatRead,
  peerOf,
  searchChats,
  setChatArchived,
  setChatMuted,
  setChatPinned,
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
  const archivedCount = useAppStore(
    (s) => Object.values(s.chats).filter((c) => c.archived).length
  );
  const archivedUnread = useAppStore(selectArchivedUnread);

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
      // Groups render every member's name in previews and bubbles, so all of
      // them get watched, not just the single peer a 1:1 chat has.
      const uids = chat.isGroup
        ? Object.keys(chat.participants ?? {}).filter((uid) => uid !== myUid)
        : [peerOf(chat, myUid)];

      for (const uid of uids) {
        if (uid && !live.has(uid)) live.set(uid, listenToUser(uid));
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

  /** Group previews prefix the sender's name; this resolves it from the cache. */
  const nameOf = useCallback((uid: string) => users[uid]?.name ?? 'Unknown', [users]);

  const onRefresh = useCallback(async () => {
    if (!myUid) return;
    setRefreshing(true);
    // Re-attaching the peer listeners is what actually refreshes names, photos
    // and presence; the chat list itself is already live.
    for (const off of watched.current.values()) off();
    watched.current.clear();
    for (const chat of chats) {
      const uids = chat.isGroup
        ? Object.keys(chat.participants ?? {}).filter((uid) => uid !== myUid)
        : [peerOf(chat, myUid)];
      for (const uid of uids) {
        if (uid && !watched.current.has(uid)) watched.current.set(uid, listenToUser(uid));
      }
    }
    setRefreshing(false);
  }, [chats, myUid]);

  const closeSearch = useCallback(() => {
    setSearching(false);
    setTerm('');
  }, []);

  const togglePin = useCallback(
    async (chat: ChatSummary) => {
      if (!myUid) return;
      try {
        await setChatPinned(myUid, chat.id, !chat.pinned);
      } catch (e) {
        alertError('Could not update the pin', String(e));
      }
    },
    [myUid]
  );

  const archive = useCallback(
    async (chat: ChatSummary) => {
      if (!myUid) return;
      try {
        // Archiving a pinned chat clears the pin, otherwise it would come back
        // pinned to the top of the main list on unarchive.
        if (chat.pinned) await setChatPinned(myUid, chat.id, false);
        await setChatArchived(myUid, chat.id, true);
      } catch (e) {
        alertError('Could not archive the chat', String(e));
      }
    },
    [myUid]
  );

  const chatActions = useMemo<SheetAction[]>(() => {
    if (!menuFor || !myUid) return [];
    const muted = isChatMuted(menuFor, myUid);
    const chatId = menuFor.id;
    const chat = menuFor;
    const unread = chat.unread?.[myUid] ?? 0;

    return [
      {
        key: 'pin',
        label: chat.pinned ? 'Unpin chat' : 'Pin chat',
        icon: chat.pinned ? 'unpin' : 'pin',
        onPress: () => togglePin(chat),
      },
      {
        key: 'archive',
        label: 'Archive chat',
        icon: 'archive',
        onPress: () => archive(chat),
      },
      ...(unread > 0
        ? [
            {
              key: 'read',
              label: 'Mark as read',
              icon: 'doubleCheck' as const,
              onPress: async () => {
                try {
                  await markChatRead(chatId, myUid);
                } catch (e) {
                  alertError('Could not mark as read', String(e));
                }
              },
            },
          ]
        : []),
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
  }, [menuFor, myUid, togglePin, archive]);

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
        ListHeaderComponent={
          // Only when there is something in there and we are not searching —
          // a permanent empty "Archived" row is just noise.
          archivedCount > 0 && term.length === 0 ? (
            <Pressable
              style={[styles.archivedRow, { borderBottomColor: theme.colors.border }]}
              onPress={() => router.push('/archived')}
              accessibilityRole="button"
              accessibilityLabel={`Archived, ${archivedCount} chats`}
            >
              <Icon name="archive" size={22} color={theme.colors.textMuted} />
              <Text style={[styles.archivedLabel, { color: theme.colors.text }]}>Archived</Text>
              {archivedUnread > 0 ? (
                <Text style={[styles.archivedCount, { color: theme.colors.accent }]}>
                  {archivedUnread}
                </Text>
              ) : null}
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => {
          const peerUid = peerOf(item, myUid);
          return (
            <SwipeableChatRow
              // Swiping while filtering would reorder the result set underneath
              // the finger, so it is disabled during search.
              enabled={term.length === 0}
              right={{
                icon: item.pinned ? 'unpin' : 'pin',
                label: item.pinned ? 'Unpin' : 'Pin',
                color: theme.colors.accent,
                onTrigger: () => void togglePin(item),
              }}
              left={{
                icon: 'archive',
                label: 'Archive',
                color: theme.colors.textMuted,
                onTrigger: () => void archive(item),
              }}
            >
              <ChatListItem
                chat={item}
                peer={peerUid ? (users[peerUid] ?? null) : null}
                myUid={myUid}
                muted={isChatMuted(item, myUid)}
                nameOf={nameOf}
                onPress={() => router.push(`/chat/${item.id}`)}
                onLongPress={() => setMenuFor(item)}
              />
            </SwipeableChatRow>
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
              onAction={() => router.push('/(tabs)/contacts')}
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
        onPress={() => router.push('/(tabs)/contacts')}
        accessibilityLabel="New chat"
      >
        <Icon name="plus" size={26} color={theme.colors.accentText} />
      </Pressable>

      <ActionSheet
        visible={menuFor !== null}
        title={
          menuFor
            ? menuFor.isGroup
              ? (menuFor.name ?? 'Group')
              : (users[peerOf(menuFor, myUid) ?? '']?.name ?? 'Chat')
            : ''
        }
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
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 18,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  archivedLabel: { flex: 1, fontSize: 16 },
  archivedCount: { fontSize: 13, fontWeight: '700' },
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
