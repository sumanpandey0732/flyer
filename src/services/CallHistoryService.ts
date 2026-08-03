import type { CallHistoryEntry } from '@/src/config/types';
import { Paths, onValue, remove } from './FirebaseService';

/**
 * CallHistoryService — read and manage call history.
 *
 * Cloud Functions writes history entries when a call ends; the client reads
 * and can delete them.
 */

export function listenToCallHistory(
  uid: string,
  cb: (items: CallHistoryEntry[]) => void
): () => void {
  return onValue(Paths.callHistory(uid), (snap) => {
    const raw = (snap.val() as Record<string, unknown> | null) ?? {};
    const items: CallHistoryEntry[] = [];

    for (const [callId, data] of Object.entries(raw)) {
      if (!data || typeof data !== 'object') continue;
      const entry = data as Record<string, unknown>;

      items.push({
        callId,
        peerId: String(entry.peerId ?? ''),
        type: (entry.type as 'voice' | 'video') ?? 'voice',
        direction: (entry.direction as 'incoming' | 'outgoing') ?? 'incoming',
        state: (entry.state as CallHistoryEntry['state']) ?? 'ended',
        startedAt: (entry.startedAt as number) ?? 0,
        durationMs: (entry.durationMs as number) ?? 0,
        missed: Boolean(entry.missed),
      });
    }

    items.sort((a, b) => b.startedAt - a.startedAt);
    cb(items);
  });
}

export async function clearCallHistory(uid: string): Promise<void> {
  await remove(Paths.callHistory(uid));
}

export async function deleteCallHistoryEntry(
  uid: string,
  callId: string
): Promise<void> {
  await remove(Paths.callHistoryItem(uid, callId));
}
