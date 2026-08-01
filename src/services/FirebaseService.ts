import { firebase } from '@react-native-firebase/database';
import type {
  FirebaseDatabaseTypes,
} from '@react-native-firebase/database';
import { Env } from '@/src/config/env';

/**
 * FirebaseService — the only module that talks to the Realtime Database
 * directly. Everything else goes through these helpers so that path
 * construction lives in exactly one place and listener teardown is uniform.
 */

const db: FirebaseDatabaseTypes.Module = Env.rtdbUrl
  ? firebase.app().database(Env.rtdbUrl)
  : firebase.database();

// Cache reads to disk so a cold start renders the last known chat list before
// the socket connects.
db.setPersistenceEnabled(true);

export type Ref = FirebaseDatabaseTypes.Reference;
/**
 * A filtered/ordered view of a path. `ref(p).orderByChild(...).limitToLast(n)`
 * returns this, not a Reference — subscribing is all the listeners below need,
 * so they accept either.
 */
export type Query = FirebaseDatabaseTypes.Query;
export type Snapshot = FirebaseDatabaseTypes.DataSnapshot;
export type Unsubscribe = () => void;

export const ServerValue = firebase.database.ServerValue;

/** Path builders. Keeping them here prevents drift from database.rules.json. */
export const Paths = {
  user: (uid: string) => `users/${uid}`,
  users: () => 'users',
  userPresence: (uid: string) => `users/${uid}/online`,
  userLastSeen: (uid: string) => `users/${uid}/lastSeen`,
  userTokens: (uid: string) => `fcmTokens/${uid}`,
  userToken: (uid: string, token: string) => `fcmTokens/${uid}/${token}`,

  chat: (chatId: string) => `chats/${chatId}`,
  chats: () => 'chats',
  userChats: (uid: string) => `userChats/${uid}`,
  userChat: (uid: string, chatId: string) => `userChats/${uid}/${chatId}`,
  unread: (chatId: string, uid: string) => `chats/${chatId}/unread/${uid}`,
  muted: (chatId: string, uid: string) => `chats/${chatId}/mutedBy/${uid}`,
  clearedAt: (chatId: string, uid: string) => `chats/${chatId}/clearedAt/${uid}`,

  messages: (chatId: string) => `messages/${chatId}`,
  message: (chatId: string, messageId: string) => `messages/${chatId}/${messageId}`,
  reaction: (chatId: string, messageId: string, uid: string) =>
    `messages/${chatId}/${messageId}/reactions/${uid}`,
  seenBy: (chatId: string, messageId: string, uid: string) =>
    `messages/${chatId}/${messageId}/seenBy/${uid}`,

  typing: (chatId: string) => `typing/${chatId}`,
  typingUser: (chatId: string, uid: string) => `typing/${chatId}/${uid}`,

  starred: (uid: string) => `starred/${uid}`,
  starredItem: (uid: string, chatId: string, messageId: string) =>
    `starred/${uid}/${chatId}__${messageId}`,

  blocks: (uid: string) => `blocks/${uid}`,
  block: (uid: string, otherUid: string) => `blocks/${uid}/${otherUid}`,
  reports: () => 'reports',

  call: (callId: string) => `calls/${callId}`,
  callState: (callId: string) => `calls/${callId}/state`,
  callOffer: (callId: string) => `calls/${callId}/offer`,
  callAnswer: (callId: string) => `calls/${callId}/answer`,
  callCandidates: (callId: string, uid: string) => `calls/${callId}/candidates/${uid}`,
  incoming: (uid: string) => `incoming/${uid}`,
  callHistory: (uid: string) => `callHistory/${uid}`,
  callHistoryItem: (uid: string, callId: string) => `callHistory/${uid}/${callId}`,

  status: (uid: string) => `status/${uid}`,
  statusItem: (uid: string, statusId: string) => `status/${uid}/${statusId}`,
  allStatus: () => 'status',

  connected: () => '.info/connected',
} as const;

export const ref = (path: string): Ref => db.ref(path);

export function serverTimestamp(): object {
  return ServerValue.TIMESTAMP;
}

/** Subscribe to a path; returns an unsubscribe you can call unconditionally. */
export function onValue(
  path: string | Ref | Query,
  cb: (snap: Snapshot) => void,
  onError?: (e: Error) => void
): Unsubscribe {
  const r = typeof path === 'string' ? ref(path) : path;
  const handler = r.on(
    'value',
    (snap) => cb(snap),
    (err) => {
      console.warn('[Flyer/rtdb] listener error', typeof path === 'string' ? path : r.key, err);
      onError?.(err as Error);
    }
  );
  return () => r.off('value', handler);
}

export function onChildAdded(
  path: string | Ref | Query,
  cb: (snap: Snapshot) => void
): Unsubscribe {
  const r = typeof path === 'string' ? ref(path) : path;
  const handler = r.on('child_added', (snap) => cb(snap));
  return () => r.off('child_added', handler);
}

export async function readOnce<T = unknown>(path: string): Promise<T | null> {
  const snap = await ref(path).once('value');
  return (snap.val() as T) ?? null;
}

export async function write(path: string, value: unknown): Promise<void> {
  await ref(path).set(value);
}

export async function update(path: string, value: object): Promise<void> {
  await ref(path).update(value);
}

/** Multi-path atomic update from the database root. */
export async function fanOut(updates: Record<string, unknown>): Promise<void> {
  await db.ref().update(updates);
}

export async function remove(path: string): Promise<void> {
  await ref(path).remove();
}

export function pushKey(path: string): string {
  const key = ref(path).push().key;
  if (!key) throw new Error(`Failed to generate push key for ${path}`);
  return key;
}

export async function increment(path: string, by: number): Promise<number> {
  const result = await ref(path).transaction((current: number | null) => (current ?? 0) + by);
  return (result.snapshot?.val() as number) ?? 0;
}

/**
 * Register a value to be written by the server if this client disconnects
 * uncleanly (crash, airplane mode, battery pull). This is what makes presence
 * honest — a client that is killed cannot write "offline" itself.
 */
export function onDisconnectSet(path: string, value: unknown) {
  return ref(path).onDisconnect().set(value);
}

export function cancelOnDisconnect(path: string) {
  return ref(path).onDisconnect().cancel();
}

export async function goOffline(): Promise<void> {
  db.goOffline();
}

export async function goOnline(): Promise<void> {
  db.goOnline();
}

export const database = db;
