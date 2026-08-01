import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Icon } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';
import { ChatListItem } from '@/src/components/ChatListItem';
import { SwipeableChatRow } from '@/src/components/SwipeableChatRow';
import { EmptyState } from '@/src/components/EmptyState';
import { ActionSheet, type SheetAction } from '@/src/components/ActionSheet';
import { alertError, confirm } from '@/src/components/Confirm';
import { selectArchivedChats, useAppStore } from '@/src/services/StateManager';
import {
  deleteChatForMe,
  isChatMuted,
  listenToUser,
  peerOf,
  setChatArchived,
} from '@/src/services/ChatEngine';
import type { ChatSummary } from '@/src/config/types';

/**
 * Archived chats.
 *
 * A plain stack screen rather than a tab: archived conversations are somewhere
 * you visit, not somewhere you live. Swiping right unarchives, which mirrors the
 * main list where swiping left archives.
 */
export default function ArchivedScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const myUid = useAppStore((s) => s.currentUser?.uid ?? null);
  const chats = useAppStore(selectArchivedChats);
  const users = useAppStore((s) => s.users);

  const [menuFor, setMenuFor] = useState<ChatSummary | null>(null);
  const watched = useRef(new Map<string, () => void>());

  useEffect(() => {
    if (!myUid) return;
    const live = watched.current;
    for (const chat of chats) {
      const peer = peerOf(chat, myUid);
      if (peer && !live.has(peer)) live.set(peer, listenToUser(peer));
    }
  }, [chats, myUid]);

  useEffect(() => {
    const live = watched.current;
    return () => {
      for (const off of live.values()) off();
      live.clear();
    };
  }, []);

  const unarchive = useCallback(
    async (chat: ChatSummary) => {
      if (!myUid) return;
      try {
        await setChatArchived(myUid, chat.id, false);
      } catch (e) {
        alertError('Could not unarchive the chat', String(e));
      }
    },
    [myUid]
  );

  const actions = useMemo<SheetAction[]>(() => {
    if (!menuFor || !myUid) return [];
    const chat = menuFor;

    return [
      {
        key: 'unarchive',
        label: 'Unarchive chat',
        icon: 'unarchive',
        onPress: () => unarchive(chat),
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
            await deleteChatForMe(chat.id, myUid);
          } catch (e) {
            alertError('Could not delete the chat', String(e));
          }
        },
      },
    ];
  }, [menuFor, myUid, unarchive]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: theme.colors.header }]}>
        <Pressable round={40} onPress={() => router.back()} accessibilityLabel="Back">
          <Icon name="back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: theme.colors.text }]}>Archived</Text>
      </View>

      <FlatList
        data={chats}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={chats.length === 0 ? styles.emptyContainer : undefined}
        renderItem={({ item }) => {
          if (!myUid) return null;
          const peerUid = peerOf(item, myUid);
          return (
            <SwipeableChatRow
              right={{
                icon: 'unarchive',
                label: 'Unarchive',
                color: theme.colors.accent,
                onTrigger: () => void unarchive(item),
              }}
            >
              <ChatListItem
                chat={item}
                peer={peerUid ? (users[peerUid] ?? null) : null}
                myUid={myUid}
                muted={isChatMuted(item, myUid)}
                onPress={() => router.push(`/chat/${item.id}`)}
                onLongPress={() => setMenuFor(item)}
              />
            </SwipeableChatRow>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="archive"
            title="No archived chats"
            body="Swipe a chat left to archive it."
          />
        }
      />

      <ActionSheet
        visible={menuFor !== null}
        title={
          menuFor && myUid ? (users[peerOf(menuFor, myUid) ?? '']?.name ?? 'Chat') : ''
        }
        actions={actions}
        onClose={() => setMenuFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 16,
    paddingLeft: 6,
    paddingVertical: 8,
    minHeight: 56,
  },
  title: { fontSize: 19, fontWeight: '600' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
});
