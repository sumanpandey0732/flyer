import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import {
  DEFAULT_PRIVACY,
  type Message,
  type ReplyRef,
  type StarredRef,
} from '@/src/config/types';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Avatar } from '@/src/components/Avatar';
import { Icon } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';
import { Composer } from '@/src/components/Composer';
import { MessageBubble } from '@/src/components/MessageBubble';
import {
  MessageActionsSheet,
  type MessageAction,
} from '@/src/components/MessageActionsSheet';
import { MediaViewer } from '@/src/components/MediaViewer';
import { SmartReplyBar } from '@/src/components/SmartReplyBar';
import { TypingIndicator } from '@/src/components/TypingIndicator';
import { alertError, confirm } from '@/src/components/Confirm';
import {
  blockUser,
  buildMessageList,
  clearChat,
  clearTyping,
  deleteMessage,
  deleteMessageForMe,
  dropQueued,
  editMessage,
  isBlockedByPeer,
  isChatMuted,
  listenToBlocks,
  listenToMessages,
  listenToStarred,
  listenToTyping,
  listenToUser,
  loadOlderMessages,
  markSeen,
  peerOf,
  previewFor,
  reportUser,
  sendMedia,
  sendText,
  setChatMuted,
  setTyping,
  toggleReaction,
  toggleStar,
  unblockUser,
  type ChatListItem,
} from '@/src/services/ChatEngine';
import { videoThumbnail } from '@/src/services/MediaManager';
import { formatLastSeen } from '@/src/services/PresenceManager';
import { CallManager } from '@/src/services/CallManager';
import { appState, selectPeerTyping, useAppStore } from '@/src/services/StateManager';
import type { PickedMedia } from '@/src/services/MediaManager';

/**
 * The conversation screen.
 *
 * Three details drive most of the structure here:
 *
 *  1. The list is inverted. A chat is read from the bottom, and inverting is the
 *     only way to keep the newest message pinned without measuring every row.
 *     The consequence is that `onEndReached` fires at the *top*, which is where
 *     the older-page loader lives, and ListFooterComponent renders above the
 *     first bubble while ListHeaderComponent renders below the last one.
 *
 *  2. `listenToMessages` replaces the store's array with the latest page on
 *     every snapshot, so pages fetched by `loadOlderMessages` cannot live in the
 *     store — they would be wiped by the next incoming message. They are held in
 *     local state and merged with the live window on render.
 *
 *  3. Every listener is chat-scoped and torn down on unmount together with the
 *     typing flag; a stale typing flag makes the peer see "typing…" forever.
 */

const EMPTY_MESSAGES: Message[] = [];

/** How many extra pages we will pull while chasing a quoted message. */
const MAX_JUMP_PAGES = 5;

const REPORT_REASONS = [
  'Spam',
  'Harassment',
  'Inappropriate content',
  'Other',
] as const;

const MUTE_OPTIONS: Array<{ key: string; label: string; ms: number }> = [
  { key: '8h', label: 'For 8 hours', ms: 8 * 60 * 60 * 1000 },
  { key: '1w', label: 'For 1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'always', label: 'Always', ms: -1 },
];

/** Newest-last, de-duplicated by id; the second list wins on conflict. */
function mergeMessages(older: Message[], live: Message[]): Message[] {
  if (older.length === 0) return live;

  const byId = new Map<string, Message>();
  for (const message of older) byId.set(message.id, message);
  for (const message of live) byId.set(message.id, message);

  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Chat ids are `sort([a, b]).join('_')`, so the peer is derivable from the route
 * alone. That matters on a cold start from a notification tap, where the chat
 * summary has not synced yet and the header would otherwise be blank.
 */
function derivePeerFromId(chatId: string, myUid: string): string | null {
  const parts = chatId.split('_');
  if (parts.length !== 2) return null;
  return parts.find((part) => part !== myUid) ?? null;
}

export default function ChatScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();

  const myUid = useAppStore((s) => s.currentUser?.uid) ?? null;
  const chat = useAppStore((s) => (chatId ? s.chats[chatId] : undefined));
  const liveMessages = useAppStore((s) =>
    chatId ? (s.messages[chatId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  );
  const blockedMap = useAppStore((s) => s.blocked);

  const peerUid = useMemo(() => {
    if (!chatId || !myUid) return null;
    return (chat ? peerOf(chat, myUid) : null) ?? derivePeerFromId(chatId, myUid);
  }, [chat, chatId, myUid]);

  const peer = useAppStore((s) => (peerUid ? s.users[peerUid] : undefined)) ?? null;
  const peerTyping = useAppStore(selectPeerTyping(chatId ?? '', myUid ?? ''));

  const [older, setOlder] = useState<Message[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => new Set());
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);
  const [actionsFor, setActionsFor] = useState<Message | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [peerBlockedMe, setPeerBlockedMe] = useState(false);

  const listRef = useRef<FlatList<ChatListItem>>(null);
  const loadingRef = useRef(false);
  const exhaustedRef = useRef(false);

  const messages = useMemo(
    () => mergeMessages(older, liveMessages),
    [older, liveMessages]
  );

  // Inverted list: index 0 must be the newest item.
  const items = useMemo(() => buildMessageList(messages).slice().reverse(), [messages]);

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [items]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const indexRef = useRef(indexById);
  indexRef.current = indexById;

  const iBlockedPeer = peerUid ? blockedMap[peerUid] === true : false;
  const muted = isChatMuted(chat, myUid ?? '');

  // Only meaningful on the jump-to-latest badge: while the chat is open the
  // read receipt clears this, so it is non-zero exactly when messages arrived
  // while scrolled away from the bottom.
  const unreadCount = myUid ? (chat?.unread?.[myUid] ?? 0) : 0;
  const privacy = peer?.privacy ?? DEFAULT_PRIVACY;
  const peerName = peer?.name ?? 'Flyer user';

  const disabledReason = iBlockedPeer
    ? `You blocked ${peerName}. Unblock them to send messages.`
    : peerBlockedMe
      ? `You can no longer send messages to ${peerName}.`
      : null;

  // --- listeners ----------------------------------------------------------

  useEffect(() => {
    if (!chatId || !myUid) return;

    const offs = [
      listenToMessages(chatId, myUid),
      listenToTyping(chatId),
      listenToBlocks(myUid),
      listenToStarred(myUid, (refs: StarredRef[]) => {
        setStarredIds(
          new Set(refs.filter((r) => r.chatId === chatId).map((r) => r.messageId))
        );
      }),
    ];

    return () => {
      for (const off of offs) off();
      void clearTyping(chatId, myUid);
    };
  }, [chatId, myUid]);

  useEffect(() => {
    if (!peerUid) return;
    return listenToUser(peerUid);
  }, [peerUid]);

  // Reset the paged history whenever the conversation changes.
  useEffect(() => {
    setOlder([]);
    setReplyTo(null);
    setEditing(null);
    exhaustedRef.current = false;
    loadingRef.current = false;
  }, [chatId]);

  // Blocks are private, so this read is rejected for anyone but the owner and
  // resolves false; treat it as a best-effort hint rather than a guarantee.
  useEffect(() => {
    if (!myUid || !peerUid) return;
    let alive = true;

    isBlockedByPeer(myUid, peerUid)
      .then((blocked) => {
        if (alive) setPeerBlockedMe(blocked);
      })
      .catch(() => {
        if (alive) setPeerBlockedMe(false);
      });

    return () => {
      alive = false;
    };
  }, [myUid, peerUid]);

  // The typing flag is a timestamp with a client-side cutoff, so nothing pushes
  // a re-render when it simply goes stale. Nudge one so "typing…" cannot stick.
  const [, setTypingTick] = useState(0);
  useEffect(() => {
    if (!peerTyping) return;
    const timer = setTimeout(() => setTypingTick((n) => n + 1), 6000);
    return () => clearTimeout(timer);
  }, [peerTyping]);

  // --- focus --------------------------------------------------------------

  const [focused, setFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!chatId) return;
      setFocused(true);
      appState.get().setActiveChat(chatId);

      return () => {
        setFocused(false);
        appState.get().setActiveChat(null);
      };
    }, [chatId])
  );

  // Receipts on focus and on every new arrival while the screen is open.
  useEffect(() => {
    if (!focused || !chatId || !myUid || liveMessages.length === 0) return;
    void markSeen(chatId, myUid, liveMessages);
  }, [focused, chatId, myUid, liveMessages]);

  // --- paging -------------------------------------------------------------

  const loadOlder = useCallback(async (): Promise<Message[] | null> => {
    if (!chatId || !myUid) return null;
    if (loadingRef.current || exhaustedRef.current) return null;

    const oldest = messagesRef.current[0];
    if (!oldest || !oldest.timestamp) return null;

    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await loadOlderMessages(chatId, oldest.timestamp, myUid);
      const known = new Set(messagesRef.current.map((m) => m.id));
      const fresh = page.filter((m) => !known.has(m.id));

      if (fresh.length === 0) {
        exhaustedRef.current = true;
        return [];
      }

      setOlder((prev) => mergeMessages(prev, fresh));
      return fresh;
    } catch (e) {
      console.warn('[Flyer/chat] loading older messages failed', e);
      return null;
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [chatId, myUid]);

  const onEndReached = useCallback(() => {
    void loadOlder();
  }, [loadOlder]);

  // --- scroll -------------------------------------------------------------

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  /**
   * The jump-to-latest button. The list is inverted, so offset 0 *is* the
   * bottom and "scrolled up" simply means a large offset. One screen height is
   * the threshold WhatsApp uses: far enough that new messages are off-screen.
   */
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = e.nativeEvent.contentOffset.y;
      const threshold = e.nativeEvent.layoutMeasurement.height * 0.8;
      setScrolledUp(offset > threshold);
    },
    []
  );

  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      // The row is not laid out yet: jump to an estimated offset, let the list
      // render, then land precisely.
      listRef.current?.scrollToOffset({
        offset: Math.max(0, info.index * info.averageItemLength),
        animated: false,
      });
      setTimeout(() => {
        if (info.index < indexRef.current.size) {
          listRef.current?.scrollToIndex({
            index: info.index,
            animated: true,
            viewPosition: 0.5,
          });
        }
      }, 220);
    },
    []
  );

  /**
   * Tapping a quoted reply. The target may be older than the loaded window, so
   * we page backwards a bounded number of times before giving up — an
   * unbounded chase on a long conversation would hang the screen.
   */
  const jumpToMessage = useCallback(
    async (messageId: string) => {
      const scroll = (index: number) => {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      };

      const known = indexRef.current.get(messageId);
      if (known !== undefined) {
        scroll(known);
        return;
      }

      for (let attempt = 0; attempt < MAX_JUMP_PAGES; attempt += 1) {
        const page = await loadOlder();
        if (!page || page.length === 0) break;

        // Give React a commit so the derived index map catches up.
        await new Promise<void>((resolve) => setTimeout(resolve, 80));

        const found = indexRef.current.get(messageId);
        if (found !== undefined) {
          scroll(found);
          return;
        }
      }

      alertError(
        'Message not available',
        'The original message is too far back in this conversation, or it was removed.'
      );
    },
    [loadOlder]
  );

  // --- sending ------------------------------------------------------------

  const handleSendText = useCallback(
    async (text: string) => {
      if (!chatId || !myUid || !peerUid) return;
      const quoted = replyTo;
      setReplyTo(null);

      try {
        await sendText(chatId, myUid, peerUid, text, quoted);
        scrollToBottom();
      } catch (e) {
        console.warn('[Flyer/chat] send failed', e);
        alertError('Message not sent', 'Check your connection and try again.');
      }
    },
    [chatId, myUid, peerUid, replyTo, scrollToBottom]
  );

  const handleSendMedia = useCallback(
    async (picked: PickedMedia[]) => {
      if (!chatId || !myUid || !peerUid || picked.length === 0) return;
      const quoted = replyTo;
      setReplyTo(null);
      scrollToBottom();

      // Sequential: a parallel burst scrambles the order of the bubbles and
      // saturates the uplink, which makes every upload slower.
      for (let i = 0; i < picked.length; i += 1) {
        const item = picked[i];
        const thumbnailUri =
          item.thumbnailUri ??
          (item.type === 'video' ? await videoThumbnail(item.uri) : null);

        try {
          await sendMedia(
            chatId,
            myUid,
            peerUid,
            {
              uri: item.uri,
              type: item.type,
              width: item.width,
              height: item.height,
              durationMs: item.durationMs,
              thumbnailUri,
            },
            undefined,
            // Only the first attachment carries the reply context.
            i === 0 ? quoted : null
          );
        } catch (e) {
          console.warn('[Flyer/chat] media send failed', e);
        }
      }
    },
    [chatId, myUid, peerUid, replyTo, scrollToBottom]
  );

  const handleSendVoice = useCallback(
    async (uri: string, durationMs: number) => {
      if (!chatId || !myUid || !peerUid) return;
      const quoted = replyTo;
      setReplyTo(null);
      scrollToBottom();

      try {
        await sendMedia(
          chatId,
          myUid,
          peerUid,
          { uri, type: 'audio', durationMs },
          undefined,
          quoted
        );
      } catch (e) {
        console.warn('[Flyer/chat] voice note failed', e);
        alertError('Voice note not sent', 'Check your connection and try again.');
      }
    },
    [chatId, myUid, peerUid, replyTo, scrollToBottom]
  );

  const handleTyping = useCallback(() => {
    if (!chatId || !myUid || disabledReason) return;
    setTyping(chatId, myUid);
  }, [chatId, myUid, disabledReason]);

  const handleCommitEdit = useCallback(
    async (text: string) => {
      if (!chatId || !editing) return;
      const target = editing;
      setEditing(null);

      try {
        await editMessage(chatId, target.id, text);
      } catch (e) {
        console.warn('[Flyer/chat] edit failed', e);
        alertError('Could not edit message', 'Please try again.');
      }
    },
    [chatId, editing]
  );

  const handleRetry = useCallback(
    async (message: Message) => {
      if (!chatId || !myUid || !peerUid) return;

      // Drop the dead copy first so the retry does not render twice.
      await dropQueued(message.id).catch(() => {});
      appState.get().removeMessage(chatId, message.id);
      setOlder((prev) => prev.filter((m) => m.id !== message.id));

      const type = message.type;

      try {
        if (type === 'text') {
          await sendText(chatId, myUid, peerUid, message.text ?? '', message.replyTo);
        } else if (message.mediaUrl) {
          await sendMedia(
            chatId,
            myUid,
            peerUid,
            {
              uri: message.mediaUrl,
              type,
              width: message.width,
              height: message.height,
              durationMs: message.durationMs,
              thumbnailUri: message.thumbUrl,
            },
            undefined,
            message.replyTo
          );
        }
      } catch (e) {
        console.warn('[Flyer/chat] retry failed', e);
      }
    },
    [chatId, myUid, peerUid]
  );

  const handleSmartReply = useCallback(
    (suggestion: string) => {
      void handleSendText(suggestion);
    },
    [handleSendText]
  );

  // --- message actions ----------------------------------------------------

  const startReply = useCallback((message: Message) => {
    setEditing(null);
    setReplyTo({
      messageId: message.id,
      senderId: message.senderId,
      type: message.type,
      preview: previewFor(message.type, message.text),
    });
  }, []);

  const openMedia = useCallback((message: Message) => {
    setViewing(message);
  }, []);

  const openActions = useCallback((message: Message) => {
    setActionsFor(message);
  }, []);

  const handleReact = useCallback(
    async (emoji: string) => {
      if (!chatId || !myUid || !actionsFor) return;
      const target = actionsFor;
      setActionsFor(null);

      try {
        await toggleReaction(chatId, target.id, myUid, emoji);
      } catch (e) {
        console.warn('[Flyer/chat] reaction failed', e);
      }
    },
    [chatId, myUid, actionsFor]
  );

  const actions = useMemo<MessageAction[]>(() => {
    const message = actionsFor;
    if (!message || !chatId || !myUid) return [];

    const mine = message.senderId === myUid;
    const list: MessageAction[] = [];

    // A send that never landed can only be retried or thrown away.
    if (message.failed) {
      list.push({
        key: 'retry',
        label: 'Try again',
        icon: 'retry',
        onPress: () => void handleRetry(message),
      });
      list.push({
        key: 'discard',
        label: 'Discard',
        icon: 'trash',
        destructive: true,
        onPress: () => {
          void dropQueued(message.id).catch(() => {});
          appState.get().removeMessage(chatId, message.id);
          setOlder((prev) => prev.filter((m) => m.id !== message.id));
        },
      });
      return list;
    }

    if (!message.deleted && !message.pending) {
      list.push({
        key: 'reply',
        label: 'Reply',
        icon: 'reply',
        onPress: () => startReply(message),
      });
    }

    if (!message.deleted && message.text) {
      list.push({
        key: 'copy',
        label: 'Copy',
        icon: 'copy',
        onPress: () => {
          Clipboard.setStringAsync(message.text ?? '').catch((e) =>
            console.warn('[Flyer/chat] copy failed', e)
          );
        },
      });
    }

    if (!message.deleted && !message.pending) {
      const starred = starredIds.has(message.id);
      list.push({
        key: 'star',
        label: starred ? 'Unstar' : 'Star',
        icon: starred ? 'starOutline' : 'star',
        onPress: () => {
          toggleStar(myUid, chatId, message.id).catch((e) =>
            console.warn('[Flyer/chat] star failed', e)
          );
        },
      });

      list.push({
        key: 'forward',
        label: 'Forward',
        icon: 'forward',
        onPress: () =>
          router.push({
            pathname: '/forward',
            params: { chatId, messageId: message.id },
          }),
      });
    }

    if (mine && !message.deleted && !message.pending && message.type === 'text') {
      list.push({
        key: 'edit',
        label: 'Edit',
        icon: 'edit',
        onPress: () => {
          setReplyTo(null);
          setEditing(message);
        },
      });
    }

    // "Delete for me" is offered on every message, including the peer's and
    // including ones already deleted for everyone — it only hides your copy.
    // "Delete for everyone" is the sender's alone.
    if (!message.pending) {
      list.push({
        key: 'deleteForMe',
        label: 'Delete for me',
        icon: 'trash',
        destructive: true,
        onPress: () => {
          void (async () => {
            const ok = await confirm({
              title: 'Delete for you?',
              message: 'This removes the message from your device only.',
              confirmLabel: 'Delete for me',
              destructive: true,
            });
            if (!ok || !myUid) return;

            try {
              if (editing?.id === message.id) setEditing(null);
              await deleteMessageForMe(chatId, message.id, myUid);
            } catch (e) {
              console.warn('[Flyer/chat] delete-for-me failed', e);
              alertError('Could not delete message', 'Please try again.');
            }
          })();
        },
      });
    }

    if (mine && !message.deleted && !message.pending) {
      list.push({
        key: 'delete',
        label: 'Delete for everyone',
        icon: 'deleteForever',
        destructive: true,
        onPress: () => {
          void (async () => {
            const ok = await confirm({
              title: 'Delete for everyone?',
              message: 'It will be replaced with "This message was deleted" for both of you.',
              confirmLabel: 'Delete',
              destructive: true,
            });
            if (!ok) return;

            try {
              if (editing?.id === message.id) setEditing(null);
              await deleteMessage(chatId, message.id);
            } catch (e) {
              console.warn('[Flyer/chat] delete failed', e);
              alertError('Could not delete message', 'Please try again.');
            }
          })();
        },
      });
    }

    return list;
  }, [actionsFor, chatId, myUid, starredIds, editing, handleRetry, startReply, router]);

  // --- header actions -----------------------------------------------------

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const openProfile = useCallback(() => {
    if (!peerUid) return;
    router.push(`/user/${peerUid}`);
  }, [peerUid, router]);

  const placeCall = useCallback(
    async (type: 'voice' | 'video') => {
      if (!peer) {
        alertError('Contact unavailable', 'This profile has not loaded yet.');
        return;
      }
      if (iBlockedPeer) {
        alertError('Unblock first', `Unblock ${peerName} before calling them.`);
        return;
      }

      try {
        const started = await CallManager.startCall(peer, type);
        if (started) router.push('/call');
      } catch (e) {
        console.warn('[Flyer/chat] call failed', e);
        alertError('Could not start the call', 'Please try again.');
      }
    },
    [peer, iBlockedPeer, peerName, router]
  );

  const applyMute = useCallback(
    async (ms: number) => {
      setMuteOpen(false);
      if (!chatId || !myUid) return;
      try {
        // -1 is the "forever" sentinel understood by isChatMuted.
        await setChatMuted(chatId, myUid, ms === -1 ? -1 : Date.now() + ms);
      } catch (e) {
        console.warn('[Flyer/chat] mute failed', e);
        alertError('Could not update notifications', 'Please try again.');
      }
    },
    [chatId, myUid]
  );

  const toggleMute = useCallback(async () => {
    setMenuOpen(false);
    if (!chatId || !myUid) return;

    if (muted) {
      try {
        await setChatMuted(chatId, myUid, null);
      } catch (e) {
        console.warn('[Flyer/chat] unmute failed', e);
        alertError('Could not update notifications', 'Please try again.');
      }
      return;
    }

    setMuteOpen(true);
  }, [chatId, myUid, muted]);

  const handleClearChat = useCallback(async () => {
    setMenuOpen(false);
    if (!chatId || !myUid) return;

    const ok = await confirm({
      title: 'Clear this chat?',
      message: 'Messages are removed for you only. Your contact keeps their copy.',
      confirmLabel: 'Clear',
      destructive: true,
    });
    if (!ok) return;

    try {
      await clearChat(chatId, myUid);
      setOlder([]);
      exhaustedRef.current = true;
      setReplyTo(null);
      setEditing(null);
    } catch (e) {
      console.warn('[Flyer/chat] clear failed', e);
      alertError('Could not clear the chat', 'Please try again.');
    }
  }, [chatId, myUid]);

  const toggleBlock = useCallback(async () => {
    setMenuOpen(false);
    if (!myUid || !peerUid) return;

    const ok = await confirm({
      title: iBlockedPeer ? `Unblock ${peerName}?` : `Block ${peerName}?`,
      message: iBlockedPeer
        ? 'They will be able to message and call you again.'
        : 'Blocked people cannot message or call you.',
      confirmLabel: iBlockedPeer ? 'Unblock' : 'Block',
      destructive: !iBlockedPeer,
    });
    if (!ok) return;

    try {
      if (iBlockedPeer) await unblockUser(myUid, peerUid);
      else await blockUser(myUid, peerUid);
    } catch (e) {
      console.warn('[Flyer/chat] block toggle failed', e);
      alertError('Could not update block list', 'Please try again.');
    }
  }, [myUid, peerUid, iBlockedPeer, peerName]);

  const submitReport = useCallback(
    async (reason: string) => {
      setReportOpen(false);
      if (!myUid || !peerUid) return;

      try {
        await reportUser(myUid, peerUid, reason, chatId ?? null);
        alertError(
          'Thanks for letting us know',
          'Our team reviews every report. You can also block this contact.'
        );
      } catch (e) {
        console.warn('[Flyer/chat] report failed', e);
        alertError('Could not send report', 'Please try again.');
      }
    },
    [myUid, peerUid, chatId]
  );

  // --- rendering ----------------------------------------------------------

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatListItem>) => {
      if (item.kind === 'day') {
        return (
          <View style={styles.dayRow}>
            <View
              style={[
                styles.dayPill,
                { backgroundColor: theme.colors.bgElevated, borderColor: theme.colors.border },
              ]}
            >
              <Text style={[styles.dayLabel, { color: theme.colors.textMuted }]}>
                {item.label}
              </Text>
            </View>
          </View>
        );
      }

      return (
        <MessageBubble
          message={item.message}
          mine={item.message.senderId === myUid}
          peerUid={peerUid}
          sender={peer}
          showTail={item.showTail}
          starred={starredIds.has(item.message.id)}
          onLongPress={openActions}
          onPressMedia={openMedia}
          onReply={startReply}
          onRetry={(message) => void handleRetry(message)}
          onPressReply={(messageId) => void jumpToMessage(messageId)}
        />
      );
    },
    [
      theme,
      myUid,
      peerUid,
      peer,
      starredIds,
      openActions,
      openMedia,
      startReply,
      handleRetry,
      jumpToMessage,
    ]
  );

  const presenceLine = peerTyping
    ? 'typing…'
    : formatLastSeen(
        peer?.online === true,
        peer?.lastSeen ?? 0,
        privacy.showLastSeen !== false
      );

  if (!chatId || !myUid) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: theme.colors.bg }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.chatWallpaper }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* --- header --- */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.header, paddingTop: insets.top + 6 },
        ]}
      >
        <Pressable
          round={38}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={30} color="#FFFFFF" />
        </Pressable>

        <Pressable
          style={styles.identity}
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel={`Open ${peerName}'s contact info`}
        >
          <Avatar
            uri={peer?.photoURL ?? null}
            name={peerName}
            uid={peerUid ?? ''}
            size={38}
            showPhoto={privacy.showPhoto !== false}
          />

          <View style={styles.identityText}>
            <Text style={styles.headerName} numberOfLines={1}>
              {peerName}
            </Text>
            {presenceLine ? (
              <Text
                style={[
                  styles.headerPresence,
                  peerTyping ? styles.headerPresenceTyping : null,
                ]}
                numberOfLines={1}
              >
                {presenceLine}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <Pressable
          round={40}
          onPress={() => void placeCall('video')}
          accessibilityRole="button"
          accessibilityLabel={`Video call ${peerName}`}
        >
          <Icon name="video" size={20} color="#FFFFFF" />
        </Pressable>

        <Pressable
          round={40}
          onPress={() => void placeCall('voice')}
          accessibilityRole="button"
          accessibilityLabel={`Voice call ${peerName}`}
        >
          <Icon name="phone" size={19} color="#FFFFFF" />
        </Pressable>

        <Pressable
          round={38}
          onPress={() => setMenuOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <Icon name="more" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* --- overflow menu --- */}
      {menuOpen ? (
        <>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
            accessibilityLabel="Close menu"
          />
          <View
            style={[
              styles.menu,
              {
                top: insets.top + 52,
                backgroundColor: theme.colors.bgElevated,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
              },
            ]}
          >
            <MenuItem label="View contact" onPress={() => { setMenuOpen(false); openProfile(); }} />
            <MenuItem
              label={muted ? 'Unmute notifications' : 'Mute notifications'}
              onPress={() => void toggleMute()}
            />
            <MenuItem label="Clear chat" onPress={() => void handleClearChat()} />
            <MenuItem
              label={iBlockedPeer ? `Unblock ${peerName}` : `Block ${peerName}`}
              destructive={!iBlockedPeer}
              onPress={() => void toggleBlock()}
            />
            <MenuItem
              label="Report"
              destructive
              onPress={() => {
                setMenuOpen(false);
                setReportOpen(true);
              }}
            />
          </View>
        </>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* The jump button is absolutely positioned against this wrapper so it
            sits above the last bubble, not over the composer. */}
        <View style={styles.flex}>
          <FlatList
            ref={listRef}
            data={items}
            inverted
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.35}
            onScroll={onScroll}
            scrollEventThrottle={64}
            onScrollToIndexFailed={onScrollToIndexFailed}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            initialNumToRender={20}
            maxToRenderPerBatch={16}
            windowSize={11}
            contentContainerStyle={[
              styles.listContent,
              items.length === 0 ? styles.listContentEmpty : null,
            ]}
            // Inverted: the footer sits above the oldest bubble, the header below
            // the newest one.
            ListFooterComponent={
              loadingOlder ? (
                <View style={styles.loaderRow}>
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                </View>
              ) : null
            }
            ListHeaderComponent={peerTyping ? <TypingIndicator /> : null}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Icon name="send" size={40} color={theme.colors.textFaint} />
                <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                  No messages yet
                </Text>
                <Text style={[styles.emptyBody, { color: theme.colors.textMuted }]}>
                  Say hello to {peerName}. Messages are delivered as soon as they are
                  online.
                </Text>
              </View>
            }
          />

          {scrolledUp ? (
            <Pressable
              onPress={scrollToBottom}
              accessibilityRole="button"
              accessibilityLabel="Scroll to latest messages"
              style={[
                styles.jumpButton,
                { backgroundColor: theme.colors.bgElevated, borderColor: theme.colors.border },
              ]}
            >
              <Icon name="chevronDown" size={24} color={theme.colors.textMuted} />
              {unreadCount > 0 ? (
                <View style={[styles.jumpBadge, { backgroundColor: theme.colors.unreadBadge }]}>
                  <Text style={[styles.jumpBadgeText, { color: theme.colors.accentText }]}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>

        {!disabledReason ? (
          <SmartReplyBar
            chatId={chatId}
            messages={messages}
            myUid={myUid}
            onPick={handleSmartReply}
          />
        ) : null}

        <View style={{ paddingBottom: insets.bottom }}>
          <Composer
            onSendText={(text) => void handleSendText(text)}
            onSendMedia={(media) => void handleSendMedia(media)}
            onSendVoice={(uri, durationMs) => void handleSendVoice(uri, durationMs)}
            onTyping={handleTyping}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            editing={editing}
            onCommitEdit={(text) => void handleCommitEdit(text)}
            onCancelEdit={() => setEditing(null)}
            disabledReason={disabledReason}
          />
        </View>
      </KeyboardAvoidingView>

      <MessageActionsSheet
        message={actionsFor}
        actions={actions}
        myReaction={actionsFor && myUid ? (actionsFor.reactions?.[myUid] ?? null) : null}
        onReact={(emoji) => void handleReact(emoji)}
        onClose={() => setActionsFor(null)}
      />

      <MediaViewer message={viewing} onClose={() => setViewing(null)} />

      <OptionSheet
        visible={muteOpen}
        title="Mute notifications"
        subtitle={`You will not be notified about new messages from ${peerName}.`}
        options={MUTE_OPTIONS.map((option) => ({ key: option.key, label: option.label }))}
        onPick={(key) => {
          const option = MUTE_OPTIONS.find((o) => o.key === key);
          if (option) void applyMute(option.ms);
        }}
        onClose={() => setMuteOpen(false)}
      />

      <OptionSheet
        visible={reportOpen}
        title={`Why are you reporting ${peerName}?`}
        subtitle="Reports are reviewed by our team. This person is not told who reported them."
        options={REPORT_REASONS.map((reason) => ({ key: reason, label: reason }))}
        onPick={(key) => void submitReport(key)}
        onClose={() => setReportOpen(false)}
      />
    </View>
  );
}

function MenuItem({
  label,
  destructive,
  onPress,
}: {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.menuItem}
    >
      <Text
        style={[
          styles.menuItemLabel,
          { color: destructive ? theme.colors.danger : theme.colors.text },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Bottom sheet of mutually exclusive choices.
 *
 * Android's Alert caps out at three buttons and drops the rest silently, so
 * anything that offers a list of options has to be a real sheet.
 */
function OptionSheet({
  visible,
  title,
  subtitle,
  options,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  options: Array<{ key: string; label: string }>;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        onPress={onClose}
        accessibilityLabel="Dismiss options"
      >
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.colors.bgElevated }]}
          onPress={() => {}}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.border }]} />
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.sheetBody, { color: theme.colors.textMuted }]}>
              {subtitle}
            </Text>
          ) : null}

          {options.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => onPick(option.key)}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              style={[styles.sheetOption, { borderTopColor: theme.colors.border }]}
            >
              <Text style={[styles.sheetOptionLabel, { color: theme.colors.text }]}>
                {option.label}
              </Text>
              <Icon name="chevron" size={18} color={theme.colors.textFaint} />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 2 },
  identityText: { flex: 1 },
  headerName: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  headerPresence: { color: 'rgba(255,255,255,0.78)', fontSize: 12, marginTop: 1 },
  headerPresenceTyping: { fontStyle: 'italic' },

  menu: {
    position: 'absolute',
    right: 8,
    minWidth: 210,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  menuItem: { paddingHorizontal: 16, paddingVertical: 13 },
  menuItemLabel: { fontSize: 15 },

  listContent: { paddingVertical: 8 },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  jumpButton: {
    position: 'absolute',
    right: 14,
    bottom: 12,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  jumpBadge: {
    position: 'absolute',
    top: -6,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpBadgeText: { fontSize: 11.5, fontWeight: '700' },
  loaderRow: { paddingVertical: 14, alignItems: 'center' },

  dayRow: { alignItems: 'center', marginVertical: 8 },
  dayPill: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayLabel: { fontSize: 12, fontWeight: '600' },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 46,
    // The list is inverted, so its children are flipped back upright here.
    transform: [{ scaleY: -1 }],
  },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: 'center' },

  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: 34,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 17, fontWeight: '600', paddingHorizontal: 20 },
  sheetBody: {
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetOptionLabel: { fontSize: 16 },
});
