/** Shared domain types. The RTDB shape is documented in database.rules.json. */

export type MessageType = 'text' | 'image' | 'video' | 'audio';

export type CallType = 'voice' | 'video';

export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'accepted'
  | 'rejected'
  | 'ended';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL: string | null;
  about: string;
  online: boolean;
  lastSeen: number;
  createdAt: number;
  privacy: PrivacySettings;
}

export interface PrivacySettings {
  /** When false, peers see "online"/"last seen" as hidden. */
  showLastSeen: boolean;
  showPhoto: boolean;
  showAbout: boolean;
  /** Read receipts are mutual: disabling also hides other people's from you. */
  readReceipts: boolean;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  showLastSeen: true,
  showPhoto: true,
  showAbout: true,
  readReceipts: true,
};

export interface ReplyRef {
  messageId: string;
  senderId: string;
  type: MessageType;
  preview: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  type: MessageType;
  text: string | null;
  mediaUrl: string | null;
  /** Poster frame for video; also used as the blurred placeholder for images. */
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  /** Milliseconds, for audio and video. */
  durationMs: number | null;
  timestamp: number;
  seenBy: Record<string, number>;
  edited: boolean;
  deleted: boolean;
  reactions: Record<string, string>;
  replyTo: ReplyRef | null;
  forwardedFrom: string | null;
  /** Client-only: set for messages sitting in the offline queue. */
  pending?: boolean;
  /** Client-only: set when a queued send exhausted its retries. */
  failed?: boolean;
}

export interface ChatSummary {
  id: string;
  participants: Record<string, boolean>;
  lastMessage: {
    text: string;
    type: MessageType;
    senderId: string;
    deleted: boolean;
  } | null;
  lastTimestamp: number;
  /** uid -> epoch ms until which the chat is muted (0 = not muted). */
  mutedBy: Record<string, number>;
  /** uid -> timestamp before which messages are hidden for that user only. */
  clearedAt: Record<string, number>;
  unread: Record<string, number>;
  /**
   * Per-user flags mirrored from `userChats/{myUid}/{chatId}`, not from the
   * shared chat node — only the signed-in user's own values are ever readable,
   * so these describe *me*, not the conversation.
   */
  pinned: boolean;
  archived: boolean;
}

export interface CallRecord {
  id: string;
  callerId: string;
  calleeId: string;
  type: CallType;
  state: CallState;
  createdAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  endedReason: 'hangup' | 'rejected' | 'missed' | 'failed' | 'busy' | null;
}

export interface CallHistoryEntry {
  callId: string;
  peerId: string;
  type: CallType;
  direction: 'incoming' | 'outgoing';
  state: CallState;
  startedAt: number;
  durationMs: number;
  missed: boolean;
}

export interface StatusPost {
  id: string;
  uid: string;
  type: 'image' | 'text';
  mediaUrl: string | null;
  text: string | null;
  background: string | null;
  createdAt: number;
  expiresAt: number;
  viewers: Record<string, number>;
}

export interface StarredRef {
  key: string;
  chatId: string;
  messageId: string;
  starredAt: number;
}

/** A send that could not reach the server and is persisted until it can. */
export interface QueuedSend {
  id: string;
  chatId: string;
  draft: Omit<Message, 'id' | 'chatId' | 'timestamp' | 'seenBy'>;
  /** Local file uri that still needs uploading, if any. */
  localUri: string | null;
  attempts: number;
  queuedAt: number;
}
