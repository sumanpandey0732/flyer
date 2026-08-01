import { Limits } from '@/src/config/env';
import type { StatusPost } from '@/src/config/types';
import {
  Paths,
  onValue,
  pushKey,
  readOnce,
  remove,
  serverTimestamp,
  write,
  type Snapshot,
  type Unsubscribe,
} from './FirebaseService';
import { compressImage, uploadToCloudinary } from './MediaManager';

/**
 * StatusService — WhatsApp-style 24-hour ephemeral stories.
 *
 * The scheduled Cloud Function reaps expired posts every 15 minutes, but we
 * filter them client-side too so the list updates without waiting for the reap.
 */

export function listenToStatuses(
  cb: (byUser: Record<string, StatusPost[]>) => void
): Unsubscribe {
  return onValue(Paths.allStatus(), (snap: Snapshot) => {
    const raw = (snap.val() as Record<string, Record<string, StatusPost>> | null) ?? {};
    const now = Date.now();
    const byUser: Record<string, StatusPost[]> = {};

    for (const [uid, posts] of Object.entries(raw)) {
      const live = Object.entries(posts)
        .map(([id, post]) => ({ ...post, id }))
        .filter((post) => post.expiresAt > now)
        .sort((a, b) => a.createdAt - b.createdAt);

      if (live.length > 0) byUser[uid] = live;
    }

    cb(byUser);
  });
}

export async function postImageStatus(uid: string, localUri: string): Promise<void> {
  const compressed = await compressImage(localUri);
  const uploaded = await uploadToCloudinary(compressed.uri, 'image');

  const statusId = pushKey(Paths.status(uid));
  await write(Paths.statusItem(uid, statusId), {
    type: 'image',
    mediaUrl: uploaded.url,
    text: null,
    background: null,
    createdAt: serverTimestamp(),
    expiresAt: Date.now() + Limits.statusTtlMs,
    viewers: {},
  });
}

export async function postTextStatus(
  uid: string,
  text: string,
  background: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const statusId = pushKey(Paths.status(uid));
  await write(Paths.statusItem(uid, statusId), {
    type: 'text',
    mediaUrl: null,
    text: trimmed,
    background,
    createdAt: serverTimestamp(),
    expiresAt: Date.now() + Limits.statusTtlMs,
    viewers: {},
  });
}

export async function markStatusViewed(
  uid: string,
  statusId: string,
  viewerUid: string
): Promise<void> {
  // Skip marking my own statuses as viewed.
  if (uid === viewerUid) return;

  const path = `${Paths.statusItem(uid, statusId)}/viewers/${viewerUid}`;
  const existing = await readOnce<number>(path);
  if (existing) return;

  await write(path, serverTimestamp()).catch(() => {
    // The status may have expired and been reaped while we were viewing it.
  });
}

export async function deleteStatus(uid: string, statusId: string): Promise<void> {
  await remove(Paths.statusItem(uid, statusId));
}
