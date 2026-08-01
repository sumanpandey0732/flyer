import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import type { QueuedSend } from '@/src/config/types';
import { appState } from './StateManager';

/**
 * OfflineQueue
 *
 * The RTDB SDK already buffers writes in memory and replays them on reconnect,
 * but that buffer dies with the process. A message typed on the underground and
 * then swiped away would be silently lost. This queue persists the intent to
 * disk and replays it after a cold start.
 *
 * Media sends are queued with their *local* uri; the upload is retried too,
 * because a Cloudinary upload that failed offline has no url to store.
 */

const STORAGE_KEY = '@flyer/outbox/v1';
const MAX_ATTEMPTS = 6;

type Sender = (item: QueuedSend) => Promise<void>;

let queue: QueuedSend[] = [];
let loaded = false;
let flushing = false;
let sender: Sender | null = null;
let netUnsub: (() => void) | null = null;

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('[Flyer/outbox] persist failed', e);
  }
  appState.get().setPendingCount(queue.length);
}

export async function loadQueue(): Promise<QueuedSend[]> {
  if (loaded) return queue;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    queue = raw ? (JSON.parse(raw) as QueuedSend[]) : [];
  } catch {
    queue = [];
  }
  loaded = true;
  appState.get().setPendingCount(queue.length);
  return queue;
}

/** Wired up by ChatEngine, which owns the actual send logic. */
export function registerSender(fn: Sender) {
  sender = fn;
}

export function startOutbox() {
  netUnsub?.();
  netUnsub = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      void flush();
    }
  });
  void loadQueue().then(() => flush());
}

export function stopOutbox() {
  netUnsub?.();
  netUnsub = null;
}

export async function enqueue(item: QueuedSend): Promise<void> {
  await loadQueue();
  queue.push(item);
  await persist();
  void flush();
}

export async function dequeue(id: string): Promise<void> {
  queue = queue.filter((q) => q.id !== id);
  await persist();
}

export function pendingFor(chatId: string): QueuedSend[] {
  return queue.filter((q) => q.chatId === chatId);
}

export function pendingAll(): QueuedSend[] {
  return [...queue];
}

/**
 * Drains the queue oldest-first. Stops at the first failure so ordering within
 * a chat is preserved — replaying message 3 before message 2 because 2 hit a
 * transient error would visibly scramble the conversation.
 */
export async function flush(): Promise<void> {
  if (flushing || !sender) return;
  await loadQueue();
  if (queue.length === 0) return;

  const net = await NetInfo.fetch();
  if (!net.isConnected || net.isInternetReachable === false) return;

  flushing = true;
  try {
    const ordered = [...queue].sort((a, b) => a.queuedAt - b.queuedAt);

    for (const item of ordered) {
      try {
        await sender(item);
        await dequeue(item.id);
      } catch (e) {
        item.attempts += 1;
        console.warn(
          `[Flyer/outbox] send failed (attempt ${item.attempts}/${MAX_ATTEMPTS})`,
          e
        );

        if (item.attempts >= MAX_ATTEMPTS) {
          // Give up but keep it visible so the user can retry or delete it,
          // rather than dropping their message on the floor.
          await dequeue(item.id);
          appState.get().upsertMessage(item.chatId, {
            ...(item.draft as never),
            id: item.id,
            chatId: item.chatId,
            timestamp: item.queuedAt,
            seenBy: {},
            pending: false,
            failed: true,
          });
        } else {
          await persist();
        }
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export async function retryFailed(id: string, item: QueuedSend): Promise<void> {
  await enqueue({ ...item, id, attempts: 0, queuedAt: Date.now() });
}

export async function clearQueueForChat(chatId: string): Promise<void> {
  queue = queue.filter((q) => q.chatId !== chatId);
  await persist();
}
