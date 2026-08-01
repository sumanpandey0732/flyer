/**
 * Shared, environment-derived configuration.
 *
 * Metro inlines `process.env.EXPO_PUBLIC_*` at build time, so these are literals
 * in the shipped bundle — they must never hold anything secret. The Cloudinary
 * preset is unsigned (that is the point) and OAuth client IDs are public.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.startsWith('REPLACE_ME') || value === 'your-cloud-name') {
    // Fail loudly at startup rather than with an opaque 401 on first upload.
    console.error(
      `[Flyer] Missing config: ${name}. Copy .env.example to .env and fill it in, ` +
        `then rebuild (env vars are inlined at build time, a reload is not enough).`
    );
    return '';
  }
  return value;
}

export const Env = {
  cloudinaryCloudName: required(
    'EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME',
    process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME
  ),
  cloudinaryUploadPreset: required(
    'EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET',
    process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET
  ),
  googleWebClientId: required(
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  ),
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  rtdbUrl: required('EXPO_PUBLIC_RTDB_URL', process.env.EXPO_PUBLIC_RTDB_URL),
} as const;

export const Limits = {
  /** Voice note ceiling, per spec. */
  voiceNoteMaxMs: 2 * 60 * 1000,
  /** Typing flag self-clears this long after the last keystroke. */
  typingIdleMs: 3000,
  /** How long an unanswered call rings before both sides give up. */
  callRingTimeoutMs: 45_000,
  /** ICE restart is attempted this long after the connection drops. */
  reconnectGraceMs: 12_000,
  /** Messages fetched per chat window. */
  messagePageSize: 40,
  /** Status/story lifetime. */
  statusTtlMs: 24 * 60 * 60 * 1000,
  imageMaxDimension: 1600,
  imageQuality: 0.7,
} as const;

/**
 * ICE configuration.
 *
 * Deliberately not annotated with the DOM's `RTCConfiguration`: TypeScript's
 * built-in lib.dom types and react-native-webrtc's own are structurally
 * different (their `certificates` and session-description types disagree), and
 * annotating with the DOM one makes this object unassignable to the native
 * RTCPeerConnection. Inference keeps it compatible with both.
 */
export const Ice = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // NOTE: STUN alone fails for roughly 10-15% of real-world pairs (symmetric
    // NAT / carrier CGNAT). Add a TURN server here before you ship widely;
    // there is no free production-grade TURN, so this is a deliberate gap.
    // { urls: 'turn:your.turn.host:3478', username: '...', credential: '...' },
  ],
  iceCandidatePoolSize: 4,
};

/** Deterministic 1:1 chat id so both participants derive the same key. */
export function chatIdFor(a: string, b: string): string {
  return [a, b].sort().join('_');
}
