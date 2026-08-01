import { create } from 'zustand';
import type {
  CallRecord,
  CallState,
  CallType,
  ChatSummary,
  Message,
  UserProfile,
} from '@/src/config/types';

/**
 * StateManager — single global store.
 *
 * Messages are held per-chat rather than only for the active chat so that
 * switching back to a recent chat renders instantly from memory while its
 * listener re-attaches.
 */

export interface ActiveCall {
  callId: string;
  peerId: string;
  peer: UserProfile | null;
  type: CallType;
  direction: 'incoming' | 'outgoing';
  state: CallState;
  /** Set when the peer connection reports `connected`; drives the timer. */
  connectedAt: number | null;
  micMuted: boolean;
  videoEnabled: boolean;
  speakerOn: boolean;
  frontCamera: boolean;
  /** True while ICE is restarting after a drop. */
  reconnecting: boolean;
  endedReason: CallRecord['endedReason'];
}

export type NetworkStatus = 'online' | 'offline' | 'reconnecting';

interface AppState {
  // --- auth / me ---
  currentUser: UserProfile | null;
  authReady: boolean;

  // --- chats ---
  chats: Record<string, ChatSummary>;
  activeChatId: string | null;
  messages: Record<string, Message[]>;
  /** chatId -> uid -> last keystroke ms */
  typingState: Record<string, Record<string, number>>;
  /** Cache of peer profiles, keyed by uid. */
  users: Record<string, UserProfile>;

  // --- calls ---
  callState: CallState;
  activeCall: ActiveCall | null;

  // --- connectivity ---
  networkStatus: NetworkStatus;
  pendingCount: number;

  // --- prefs ---
  themeMode: 'system' | 'light' | 'dark';
  blocked: Record<string, boolean>;

  // --- actions ---
  setCurrentUser: (u: UserProfile | null) => void;
  patchCurrentUser: (patch: Partial<UserProfile>) => void;
  setAuthReady: (v: boolean) => void;

  setChats: (chats: Record<string, ChatSummary>) => void;
  upsertChat: (chat: ChatSummary) => void;
  removeChat: (chatId: string) => void;
  setActiveChat: (chatId: string | null) => void;

  setMessages: (chatId: string, messages: Message[]) => void;
  upsertMessage: (chatId: string, message: Message) => void;
  removeMessage: (chatId: string, messageId: string) => void;

  setTyping: (chatId: string, map: Record<string, number>) => void;
  cacheUser: (user: UserProfile) => void;
  cacheUsers: (users: UserProfile[]) => void;

  setCallState: (s: CallState) => void;
  startCall: (call: ActiveCall) => void;
  patchCall: (patch: Partial<ActiveCall>) => void;
  clearCall: () => void;

  setNetworkStatus: (s: NetworkStatus) => void;
  setPendingCount: (n: number) => void;

  setThemeMode: (m: 'system' | 'light' | 'dark') => void;
  setBlocked: (map: Record<string, boolean>) => void;

  reset: () => void;
}

const initial = {
  currentUser: null as UserProfile | null,
  authReady: false,
  chats: {} as Record<string, ChatSummary>,
  activeChatId: null as string | null,
  messages: {} as Record<string, Message[]>,
  typingState: {} as Record<string, Record<string, number>>,
  users: {} as Record<string, UserProfile>,
  callState: 'idle' as CallState,
  activeCall: null as ActiveCall | null,
  networkStatus: 'online' as NetworkStatus,
  pendingCount: 0,
  themeMode: 'system' as 'system' | 'light' | 'dark',
  blocked: {} as Record<string, boolean>,
};

/** Messages are kept sorted ascending; dedup by id (server echo vs local). */
function mergeMessage(list: Message[], message: Message): Message[] {
  const idx = list.findIndex((m) => m.id === message.id);
  if (idx === -1) {
    const next = [...list, message];
    next.sort((a, b) => a.timestamp - b.timestamp);
    return next;
  }
  const next = [...list];
  next[idx] = { ...next[idx], ...message };
  return next;
}

export const useAppStore = create<AppState>((set) => ({
  ...initial,

  setCurrentUser: (currentUser) => set({ currentUser }),
  patchCurrentUser: (patch) =>
    set((s) => (s.currentUser ? { currentUser: { ...s.currentUser, ...patch } } : s)),
  setAuthReady: (authReady) => set({ authReady }),

  setChats: (chats) => set({ chats }),
  upsertChat: (chat) => set((s) => ({ chats: { ...s.chats, [chat.id]: chat } })),
  removeChat: (chatId) =>
    set((s) => {
      const chats = { ...s.chats };
      delete chats[chatId];
      const messages = { ...s.messages };
      delete messages[chatId];
      return { chats, messages };
    }),
  setActiveChat: (activeChatId) => set({ activeChatId }),

  setMessages: (chatId, list) =>
    set((s) => ({ messages: { ...s.messages, [chatId]: list } })),
  upsertMessage: (chatId, message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: mergeMessage(s.messages[chatId] ?? [], message),
      },
    })),
  removeMessage: (chatId, messageId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).filter((m) => m.id !== messageId),
      },
    })),

  setTyping: (chatId, map) =>
    set((s) => ({ typingState: { ...s.typingState, [chatId]: map } })),
  cacheUser: (user) => set((s) => ({ users: { ...s.users, [user.uid]: user } })),
  cacheUsers: (list) =>
    set((s) => {
      const users = { ...s.users };
      for (const u of list) users[u.uid] = u;
      return { users };
    }),

  setCallState: (callState) =>
    set((s) => ({
      callState,
      activeCall: s.activeCall ? { ...s.activeCall, state: callState } : null,
    })),
  startCall: (activeCall) => set({ activeCall, callState: activeCall.state }),
  patchCall: (patch) =>
    set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, ...patch } } : s)),
  clearCall: () => set({ activeCall: null, callState: 'idle' }),

  setNetworkStatus: (networkStatus) => set({ networkStatus }),
  setPendingCount: (pendingCount) => set({ pendingCount }),

  setThemeMode: (themeMode) => set({ themeMode }),
  setBlocked: (blocked) => set({ blocked }),

  reset: () => set({ ...initial, authReady: true }),
}));

/** Non-reactive access, for use inside services and background handlers. */
export const appState = {
  get: () => useAppStore.getState(),
  set: useAppStore.setState,
};

// --- selectors ---

/**
 * Pinned chats first, then most-recent. Archived chats are excluded — they live
 * behind the "Archived" row, exactly like WhatsApp.
 */
export const selectSortedChats = (s: AppState): ChatSummary[] =>
  Object.values(s.chats)
    .filter((c) => !c.archived)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastTimestamp - a.lastTimestamp;
    });

export const selectArchivedChats = (s: AppState): ChatSummary[] =>
  Object.values(s.chats)
    .filter((c) => c.archived)
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp);

/**
 * Unread across archived chats too: the count on the Archived row is what tells
 * the user something is waiting in there.
 */
export const selectArchivedUnread = (s: AppState): number => {
  const uid = s.currentUser?.uid;
  if (!uid) return 0;
  return Object.values(s.chats)
    .filter((c) => c.archived)
    .reduce((sum, c) => sum + (c.unread?.[uid] ?? 0), 0);
};

export const selectTotalUnread = (s: AppState): number => {
  const uid = s.currentUser?.uid;
  if (!uid) return 0;
  return Object.values(s.chats).reduce((sum, c) => sum + (c.unread?.[uid] ?? 0), 0);
};

export const selectPeerTyping = (chatId: string, myUid: string) => (s: AppState) => {
  const map = s.typingState[chatId];
  if (!map) return false;
  const cutoff = Date.now() - 6000;
  return Object.entries(map).some(([uid, ts]) => uid !== myUid && ts > cutoff);
};
