import { Limits, chatIdFor } from '@/src/config/env';
import type {
  ChatSummary,
  Message,
  MessageType,
  QueuedSend,
  ReplyRef,
  StarredRef,
  UserProfile,
} from '@/src/config/types';
import {
  Paths,
  fanOut,
  increment,
  onValue,
  pushKey,
  readOnce,
  ref,
  remove,
  serverTimestamp,
  update,
  write,
  type Unsubscribe,
} from './FirebaseService';
import {
  enqueue,
  pendingFor,
  registerSender,
  dequeue,
} from './OfflineQueue';
import { appState } from './StateManager';
import { uploadToCloudinary, videoPoster } from './MediaManager';

/**
 * ChatEngine — all conversation mutations and listeners.
 *
 * Two invariants worth stating up front:
 *
 *  1. Writes that touch more than one path go through `fanOut` (a single
 *     multi-location update). A message write touches messages/, chats/ and
 *     both userChats/ indexes; doing that as four sequential sets means a
 *     crash halfway leaves a message that no chat list points at.
 *
 *  2. `timestamp` is always ServerValue.TIMESTAMP. Client clocks are wrong often
 *     enough that trusting them visibly misorders conversations.
 */

// --- normalisation --------------------------------------------------------

function normaliseMessage(id: string, chatId: string, raw: Record<string, unknown>): Message {
  return {
    id,
    chatId,
    senderId: String(raw.senderId ?? ''),
    type: (raw.type as MessageType) ?? 'text',
    text: (raw.text as string | null) ?? null,
    mediaUrl: (raw.mediaUrl as string | null) ?? null,
    thumbUrl: (raw.thumbUrl as string | null) ?? null,
    width: (raw.width as number | null) ?? null,
    height: (raw.height as number | null) ?? null,
    durationMs: (raw.durationMs as number | null) ?? null,
    timestamp: (raw.timestamp as number) ?? 0,
    seenBy: (raw.seenBy as Record<string, number>) ?? {},
    edited: Boolean(raw.edited),
    deleted: Boolean(raw.deleted),
    reactions: (raw.reactions as Record<string, string>) ?? {},
    replyTo: (raw.replyTo as ReplyRef | null) ?? null,
    forwardedFrom: (raw.forwardedFrom as string | null) ?? null,
  };
}

/** Per-user flags from `userChats/{uid}/{chatId}`, merged in by listenToChats. */
interface UserChatFlags {
  pinned: boolean;
  archived: boolean;
}

function normaliseChat(
  id: string,
  raw: Record<string, unknown>,
  flags: UserChatFlags
): ChatSummary {
  return {
    id,
    participants: (raw.participants as Record<string, boolean>) ?? {},
    lastMessage: (raw.lastMessage as ChatSummary['lastMessage']) ?? null,
    lastTimestamp: (raw.lastTimestamp as number) ?? 0,
    mutedBy: (raw.mutedBy as Record<string, number>) ?? {},
    clearedAt: (raw.clearedAt as Record<string, number>) ?? {},
    unread: (raw.unread as Record<string, number>) ?? {},
    pinned: flags.pinned,
    archived: flags.archived,
  };
}

export function previewFor(type: MessageType, text: string | null): string {
  switch (type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎤 Voice note';
    default:
      return text ?? '';
  }
}

// --- listeners -----------------------------------------------------------

/**
 * Subscribes to the signed-in user's chat list.
 *
 * We fan out through `userChats/{uid}` rather than querying `/chats` because
 * security rules cannot filter a list read — a query over /chats would be
 * rejected wholesale for any user who is not a participant in every result.
 */
export function listenToChats(uid: string): Unsubscribe {
  const perChat = new Map<string, Unsubscribe>();
  // Latest flags per chat, so a chat-node update can re-emit without waiting
  // for the index to fire again (and vice versa).
  const flags = new Map<string, UserChatFlags>();
  const latest = new Map<string, Record<string, unknown>>();

  const emit = (chatId: string) => {
    const raw = latest.get(chatId);
    if (!raw) return;
    const f = flags.get(chatId) ?? { pinned: false, archived: false };
    appState.get().upsertChat(normaliseChat(chatId, raw, f));
  };

  const offIndex = onValue(Paths.userChats(uid), (snap) => {
    const index = (snap.val() as Record<string, Record<string, unknown>> | null) ?? {};
    const ids = new Set(Object.keys(index));

    for (const [chatId, off] of perChat) {
      if (!ids.has(chatId)) {
        off();
        perChat.delete(chatId);
        flags.delete(chatId);
        latest.delete(chatId);
        appState.get().removeChat(chatId);
      }
    }

    for (const chatId of ids) {
      const entry = index[chatId] ?? {};
      flags.set(chatId, {
        pinned: entry.pinned === true,
        archived: entry.archived === true,
      });

      if (perChat.has(chatId)) {
        // Already subscribed — the index fired because a flag changed.
        emit(chatId);
        continue;
      }

      const off = onValue(Paths.chat(chatId), (chatSnap) => {
        const raw = chatSnap.val() as Record<string, unknown> | null;
        if (!raw) {
          latest.delete(chatId);
          appState.get().removeChat(chatId);
          return;
        }
        latest.set(chatId, raw);
        emit(chatId);
      });
      perChat.set(chatId, off);
    }
  });

  return () => {
    offIndex();
    for (const off of perChat.values()) off();
    perChat.clear();
    flags.clear();
    latest.clear();
  };
}

/**
 * Message listener for one chat, limited to the most recent page.
 *
 * `clearedAt` is applied client-side: "clear chat" is per-user, so the messages
 * still exist for the other participant and must not be deleted server-side.
 */
export function listenToMessages(chatId: string, uid: string): Unsubscribe {
  const query = ref(Paths.messages(chatId))
    .orderByChild('timestamp')
    .limitToLast(Limits.messagePageSize);

  return onValue(query, (snap) => {
    const raw = (snap.val() as Record<string, Record<string, unknown>> | null) ?? {};
    const clearedAt = appState.get().chats[chatId]?.clearedAt?.[uid] ?? 0;

    const list = Object.entries(raw)
      .map(([id, value]) => normaliseMessage(id, chatId, value))
      .filter((m) => m.timestamp > clearedAt)
      .sort((a, b) => a.timestamp - b.timestamp);

    // Queued-but-unsent messages are appended so they appear in the transcript
    // with a clock icon instead of vanishing until connectivity returns.
    const pending = pendingFor(chatId).map<Message>((q) => ({
      ...(q.draft as unknown as Message),
      id: q.id,
      chatId,
      timestamp: q.queuedAt,
      seenBy: {},
      pending: true,
    }));

    appState.get().setMessages(chatId, [...list, ...pending]);
  });
}

/** Older pages, for infinite scroll upward. */
export async function loadOlderMessages(
  chatId: string,
  before: number,
  uid: string
): Promise<Message[]> {
  const snap = await ref(Paths.messages(chatId))
    .orderByChild('timestamp')
    .endAt(before - 1)
    .limitToLast(Limits.messagePageSize)
    .once('value');

  const raw = (snap.val() as Record<string, Record<string, unknown>> | null) ?? {};
  const clearedAt = appState.get().chats[chatId]?.clearedAt?.[uid] ?? 0;

  return Object.entries(raw)
    .map(([id, value]) => normaliseMessage(id, chatId, value))
    .filter((m) => m.timestamp > clearedAt)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function listenToTyping(chatId: string): Unsubscribe {
  return onValue(Paths.typing(chatId), (snap) => {
    appState.get().setTyping(chatId, (snap.val() as Record<string, number>) ?? {});
  });
}

export function listenToUser(uid: string): Unsubscribe {
  return onValue(Paths.user(uid), (snap) => {
    const raw = snap.val() as UserProfile | null;
    if (raw) appState.get().cacheUser({ ...raw, uid });
  });
}

export function listenToBlocks(uid: string): Unsubscribe {
  return onValue(Paths.blocks(uid), (snap) => {
    appState.get().setBlocked((snap.val() as Record<string, boolean>) ?? {});
  });
}

// --- chat lifecycle ------------------------------------------------------

/** Idempotent: safe to call every time a chat is opened. */
export async function ensureChat(myUid: string, peerUid: string): Promise<string> {
  const chatId = chatIdFor(myUid, peerUid);
  const existing = await readOnce<ChatSummary>(Paths.chat(chatId));

  if (!existing) {
    await fanOut({
      [Paths.chat(chatId)]: {
        participants: { [myUid]: true, [peerUid]: true },
        lastMessage: null,
        lastTimestamp: serverTimestamp(),
        unread: { [myUid]: 0, [peerUid]: 0 },
      },
      [Paths.userChat(myUid, chatId)]: { lastTimestamp: serverTimestamp() },
      [Paths.userChat(peerUid, chatId)]: { lastTimestamp: serverTimestamp() },
    });
  }

  return chatId;
}

export function peerOf(chat: ChatSummary, myUid: string): string | null {
  return Object.keys(chat.participants ?? {}).find((uid) => uid !== myUid) ?? null;
}

// --- sending -------------------------------------------------------------

interface SendOptions {
  chatId: string;
  senderId: string;
  peerId: string;
  type: MessageType;
  text?: string | null;
  mediaUrl?: string | null;
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  replyTo?: ReplyRef | null;
  forwardedFrom?: string | null;
}

/** Writes the message and both chat-list indexes atomically. */
async function commitMessage(opts: SendOptions, messageId: string): Promise<void> {
  const { chatId, senderId, peerId } = opts;

  const payload = {
    senderId,
    type: opts.type,
    text: opts.text ?? null,
    mediaUrl: opts.mediaUrl ?? null,
    thumbUrl: opts.thumbUrl ?? null,
    width: opts.width ?? null,
    height: opts.height ?? null,
    durationMs: opts.durationMs ?? null,
    timestamp: serverTimestamp(),
    seenBy: { [senderId]: serverTimestamp() },
    edited: false,
    deleted: false,
    reactions: {},
    replyTo: opts.replyTo ?? null,
    forwardedFrom: opts.forwardedFrom ?? null,
  };

  await fanOut({
    [Paths.message(chatId, messageId)]: payload,
    [`${Paths.chat(chatId)}/lastMessage`]: {
      text: previewFor(opts.type, opts.text ?? null),
      type: opts.type,
      senderId,
      deleted: false,
    },
    [`${Paths.chat(chatId)}/lastTimestamp`]: serverTimestamp(),
    // Leaf writes, not `{lastTimestamp}` objects: setting the parent would
    // replace the node and wipe the owner's `pinned`/`archived` flags.
    [`${Paths.userChat(senderId, chatId)}/lastTimestamp`]: serverTimestamp(),
    [`${Paths.userChat(peerId, chatId)}/lastTimestamp`]: serverTimestamp(),
  });

  // Separate transaction: a fan-out cannot express "increment" atomically.
  await increment(Paths.unread(chatId, peerId), 1).catch(() => {});
}

export async function sendText(
  chatId: string,
  senderId: string,
  peerId: string,
  text: string,
  replyTo: ReplyRef | null = null
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const messageId = pushKey(Paths.messages(chatId));
  const opts: SendOptions = { chatId, senderId, peerId, type: 'text', text: trimmed, replyTo };

  if (appState.get().networkStatus === 'offline') {
    await enqueue({
      id: messageId,
      chatId,
      draft: {
        senderId,
        type: 'text',
        text: trimmed,
        mediaUrl: null,
        thumbUrl: null,
        width: null,
        height: null,
        durationMs: null,
        edited: false,
        deleted: false,
        reactions: {},
        replyTo,
        forwardedFrom: null,
      },
      localUri: null,
      attempts: 0,
      queuedAt: Date.now(),
    });
    return;
  }

  await commitMessage(opts, messageId);
  await clearTyping(chatId, senderId);
}

/**
 * Media send. The bubble is rendered immediately from the local uri, so the
 * upload happens after the optimistic insert and the real url replaces it.
 */
export async function sendMedia(
  chatId: string,
  senderId: string,
  peerId: string,
  media: {
    uri: string;
    type: 'image' | 'video' | 'audio';
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    thumbnailUri?: string | null;
  },
  onProgress?: (fraction: number) => void,
  replyTo: ReplyRef | null = null
): Promise<void> {
  const messageId = pushKey(Paths.messages(chatId));

  const draft: QueuedSend['draft'] = {
    senderId,
    type: media.type,
    text: null,
    mediaUrl: media.uri,
    thumbUrl: media.thumbnailUri ?? null,
    width: media.width ?? null,
    height: media.height ?? null,
    durationMs: media.durationMs ?? null,
    edited: false,
    deleted: false,
    reactions: {},
    replyTo,
    forwardedFrom: null,
  };

  // Optimistic bubble with a progress spinner.
  appState.get().upsertMessage(chatId, {
    ...(draft as unknown as Message),
    id: messageId,
    chatId,
    timestamp: Date.now(),
    seenBy: {},
    pending: true,
  });

  if (appState.get().networkStatus === 'offline') {
    await enqueue({
      id: messageId,
      chatId,
      draft,
      localUri: media.uri,
      attempts: 0,
      queuedAt: Date.now(),
    });
    return;
  }

  try {
    // Cloudinary treats audio as a 'video' resource; there is no audio endpoint.
    const resource = media.type === 'image' ? 'image' : 'video';
    const uploaded = await uploadToCloudinary(media.uri, resource, onProgress);

    await commitMessage(
      {
        chatId,
        senderId,
        peerId,
        type: media.type,
        mediaUrl: uploaded.url,
        thumbUrl: media.type === 'video' ? videoPoster(uploaded.url) : null,
        width: uploaded.width ?? media.width ?? null,
        height: uploaded.height ?? media.height ?? null,
        durationMs: uploaded.durationMs ?? media.durationMs ?? null,
        replyTo,
      },
      messageId
    );
  } catch (e) {
    console.warn('[Flyer/chat] media send failed, queueing', e);
    appState.get().upsertMessage(chatId, {
      ...(draft as unknown as Message),
      id: messageId,
      chatId,
      timestamp: Date.now(),
      seenBy: {},
      pending: false,
      failed: true,
    });
    throw e;
  }
}

/** Replays a queued send once connectivity returns. */
registerSender(async (item: QueuedSend) => {
  const chat = appState.get().chats[item.chatId];
  const myUid = item.draft.senderId;
  const peerId = chat ? peerOf(chat, myUid) : null;
  if (!peerId) throw new Error(`Cannot resolve peer for chat ${item.chatId}`);

  let mediaUrl = item.draft.mediaUrl;
  let thumb = item.draft.thumbUrl;

  if (item.localUri) {
    const resource = item.draft.type === 'image' ? 'image' : 'video';
    const uploaded = await uploadToCloudinary(item.localUri, resource);
    mediaUrl = uploaded.url;
    thumb = item.draft.type === 'video' ? videoPoster(uploaded.url) : null;
  }

  await commitMessage(
    {
      chatId: item.chatId,
      senderId: myUid,
      peerId,
      type: item.draft.type,
      text: item.draft.text,
      mediaUrl,
      thumbUrl: thumb,
      width: item.draft.width,
      height: item.draft.height,
      durationMs: item.draft.durationMs,
      replyTo: item.draft.replyTo,
      forwardedFrom: item.draft.forwardedFrom,
    },
    item.id
  );
});

// --- mutations -----------------------------------------------------------

export async function editMessage(
  chatId: string,
  messageId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await update(Paths.message(chatId, messageId), { text: trimmed, edited: true });

  // Keep the chat-list preview honest if the edited message was the latest.
  const chat = appState.get().chats[chatId];
  const messages = appState.get().messages[chatId] ?? [];
  const latest = messages[messages.length - 1];
  if (chat && latest?.id === messageId) {
    await update(`${Paths.chat(chatId)}/lastMessage`, { text: trimmed });
  }
}

/** Soft delete — the row stays so both sides render "This message was deleted". */
export async function deleteMessage(chatId: string, messageId: string): Promise<void> {
  await update(Paths.message(chatId, messageId), {
    deleted: true,
    text: null,
    mediaUrl: null,
    thumbUrl: null,
  });

  const messages = appState.get().messages[chatId] ?? [];
  if (messages[messages.length - 1]?.id === messageId) {
    await update(`${Paths.chat(chatId)}/lastMessage`, {
      text: 'This message was deleted',
      deleted: true,
    });
  }
}

export async function toggleReaction(
  chatId: string,
  messageId: string,
  uid: string,
  emoji: string
): Promise<void> {
  const path = Paths.reaction(chatId, messageId, uid);
  const current = await readOnce<string>(path);
  // Tapping the same emoji twice removes it.
  await write(path, current === emoji ? null : emoji);
}

/**
 * Marks messages seen. Respects the mutual read-receipt setting: if I have
 * receipts off, I do not broadcast mine either.
 */
export async function markSeen(
  chatId: string,
  uid: string,
  messages: Message[]
): Promise<void> {
  const me = appState.get().currentUser;
  if (me?.privacy?.readReceipts === false) {
    await write(Paths.unread(chatId, uid), 0).catch(() => {});
    return;
  }

  const updates: Record<string, unknown> = {};
  for (const m of messages) {
    if (m.senderId === uid || m.pending) continue;
    if (m.seenBy?.[uid]) continue;
    updates[Paths.seenBy(chatId, m.id, uid)] = serverTimestamp();
  }

  updates[Paths.unread(chatId, uid)] = 0;
  await fanOut(updates).catch((e) => console.warn('[Flyer/chat] markSeen failed', e));
}

// --- typing --------------------------------------------------------------

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setTyping(chatId: string, uid: string): void {
  const key = `${chatId}:${uid}`;
  write(Paths.typingUser(chatId, uid), Date.now()).catch(() => {});

  const existing = typingTimers.get(key);
  if (existing) clearTimeout(existing);

  typingTimers.set(
    key,
    setTimeout(() => {
      void clearTyping(chatId, uid);
      typingTimers.delete(key);
    }, Limits.typingIdleMs)
  );
}

export async function clearTyping(chatId: string, uid: string): Promise<void> {
  const key = `${chatId}:${uid}`;
  const existing = typingTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    typingTimers.delete(key);
  }
  await remove(Paths.typingUser(chatId, uid)).catch(() => {});
}

// --- starred / forward / mute / block ------------------------------------

export async function toggleStar(
  uid: string,
  chatId: string,
  messageId: string
): Promise<boolean> {
  const path = Paths.starredItem(uid, chatId, messageId);
  const existing = await readOnce(path);
  if (existing) {
    await remove(path);
    return false;
  }
  await write(path, { chatId, messageId, starredAt: serverTimestamp() });
  return true;
}

export function listenToStarred(uid: string, cb: (items: StarredRef[]) => void): Unsubscribe {
  return onValue(Paths.starred(uid), (snap) => {
    const raw = (snap.val() as Record<string, StarredRef> | null) ?? {};
    cb(
      Object.entries(raw)
        .map(([key, value]) => ({ ...value, key }))
        .sort((a, b) => b.starredAt - a.starredAt)
    );
  });
}

/** Internal-only forward: re-sends the payload into another chat. */
export async function forwardMessage(
  message: Message,
  myUid: string,
  targetPeerUid: string
): Promise<void> {
  const chatId = await ensureChat(myUid, targetPeerUid);
  const messageId = pushKey(Paths.messages(chatId));

  await commitMessage(
    {
      chatId,
      senderId: myUid,
      peerId: targetPeerUid,
      type: message.type,
      text: message.text,
      mediaUrl: message.mediaUrl,
      thumbUrl: message.thumbUrl,
      width: message.width,
      height: message.height,
      durationMs: message.durationMs,
      forwardedFrom: message.senderId,
    },
    messageId
  );
}

export async function setChatMuted(
  chatId: string,
  uid: string,
  until: number | null
): Promise<void> {
  await write(Paths.muted(chatId, uid), until ?? 0);
}

/**
 * Pin and archive write to the caller's own `userChats` index, so they are
 * invisible to the peer and survive independently of the shared chat node.
 * Both write `false` rather than removing the key, because the index entry's
 * `.validate` requires `lastTimestamp` to remain present.
 */
export async function setChatPinned(
  uid: string,
  chatId: string,
  pinned: boolean
): Promise<void> {
  await write(Paths.pinned(uid, chatId), pinned);
}

export async function setChatArchived(
  uid: string,
  chatId: string,
  archived: boolean
): Promise<void> {
  await write(Paths.archived(uid, chatId), archived);
}

export function isChatMuted(chat: ChatSummary | undefined, uid: string): boolean {
  const until = chat?.mutedBy?.[uid] ?? 0;
  // -1 is the sentinel for "mute forever".
  return until === -1 || until > Date.now();
}

/**
 * Clears my unread badge without opening the chat. Deliberately does *not*
 * touch `seenBy` on the messages — the peer's read receipts should only turn
 * blue when the messages were actually on screen.
 */
export async function markChatRead(chatId: string, uid: string): Promise<void> {
  await write(Paths.unread(chatId, uid), 0);
}

/** Per-user clear: hides history for me, leaves the peer's copy intact. */
export async function clearChat(chatId: string, uid: string): Promise<void> {
  await write(Paths.clearedAt(chatId, uid), serverTimestamp());
  await write(Paths.unread(chatId, uid), 0);
  appState.get().setMessages(chatId, []);
}

export async function blockUser(myUid: string, otherUid: string): Promise<void> {
  await write(Paths.block(myUid, otherUid), true);
}

export async function unblockUser(myUid: string, otherUid: string): Promise<void> {
  await remove(Paths.block(myUid, otherUid));
}

export async function isBlockedByPeer(myUid: string, peerUid: string): Promise<boolean> {
  // Rules deny this read (blocks are private), so treat a rejection as "not
  // blocked" and let the send fail loudly instead of guessing.
  try {
    return (await readOnce<boolean>(Paths.block(peerUid, myUid))) === true;
  } catch {
    return false;
  }
}

export async function reportUser(
  reporterId: string,
  reportedId: string,
  reason: string,
  chatId: string | null
): Promise<void> {
  const key = pushKey(Paths.reports());
  await write(`${Paths.reports()}/${key}`, {
    reporterId,
    reportedId,
    reason,
    chatId,
    createdAt: serverTimestamp(),
  });
}

export async function deleteChatForMe(chatId: string, uid: string): Promise<void> {
  await clearChat(chatId, uid);
  await remove(Paths.userChat(uid, chatId));
  appState.get().removeChat(chatId);
}

// --- contacts / search ---------------------------------------------------

export async function fetchAllUsers(myUid: string): Promise<UserProfile[]> {
  const snap = await ref(Paths.users()).once('value');
  const raw = (snap.val() as Record<string, UserProfile> | null) ?? {};
  return Object.entries(raw)
    .filter(([uid]) => uid !== myUid)
    .map(([uid, value]) => ({ ...value, uid }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export function searchChats(
  chats: ChatSummary[],
  users: Record<string, UserProfile>,
  myUid: string,
  term: string
): ChatSummary[] {
  const q = term.trim().toLowerCase();
  if (!q) return chats;

  return chats.filter((chat) => {
    const peer = peerOf(chat, myUid);
    const name = peer ? (users[peer]?.name ?? '') : '';
    const last = chat.lastMessage?.text ?? '';
    return name.toLowerCase().includes(q) || last.toLowerCase().includes(q);
  });
}

// --- date grouping -------------------------------------------------------

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const withinWeek = now.getTime() - ts < 7 * 24 * 60 * 60 * 1000;
  if (withinWeek) return d.toLocaleDateString(undefined, { weekday: 'long' });

  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export type ChatListItem =
  | { kind: 'day'; id: string; label: string }
  | { kind: 'message'; id: string; message: Message; showTail: boolean };

/**
 * Flattens messages into a render list with date separators, and marks which
 * bubbles get a tail (last in a run from the same sender).
 */
export function buildMessageList(messages: Message[]): ChatListItem[] {
  const items: ChatListItem[] = [];
  let lastDay = '';

  messages.forEach((message, i) => {
    const label = dayLabel(message.timestamp);
    if (label !== lastDay) {
      items.push({ kind: 'day', id: `day-${label}-${message.id}`, label });
      lastDay = label;
    }

    const next = messages[i + 1];
    const showTail =
      !next ||
      next.senderId !== message.senderId ||
      next.timestamp - message.timestamp > 60_000;

    items.push({ kind: 'message', id: message.id, message, showTail });
  });

  return items;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export { dequeue as dropQueued };
