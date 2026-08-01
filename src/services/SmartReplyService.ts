import AsyncStorage from '@react-native-async-storage/async-storage';
import functions from '@react-native-firebase/functions';
import type { Message } from '@/src/config/types';

/**
 * SmartReplyService — AI reply suggestions, off by default.
 *
 * Privacy: turning this on means the last few messages of a conversation leave
 * the user's Firebase project and go to Mistral. That is a real disclosure, so
 * the toggle defaults to OFF and the settings screen says so in plain words.
 *
 * Key handling: the Mistral API key never touches this file or the bundle.
 * Anything shipped to the device is extractable — `EXPO_PUBLIC_*` values are
 * inlined into the JS bundle at build time and `apktool` recovers them in
 * seconds. The key lives as a Firebase secret and is only read inside the
 * `smartReply` Cloud Function, which also re-checks that the caller is signed
 * in and is actually a participant of the chat before any text is forwarded.
 *
 * Failure policy: suggestions are a nicety. Every error path here returns an
 * empty array. A Mistral outage, a quota exhaustion, or a cold-start timeout
 * must never surface as an error in the chat.
 */

const STORAGE_KEY = '@flyer/smartReply/enabled';

/** How much history the model gets. Enough for context, small enough to stay cheap. */
const CONTEXT_MESSAGES = 10;
const MAX_SUGGESTIONS = 3;

/** A suggestion longer than this is a paragraph, not a tap-to-send reply. */
const MAX_SUGGESTION_CHARS = 120;

/** Mistral behind a cold-started function; past this the moment has passed. */
const REQUEST_TIMEOUT_MS = 12_000;

let enabled = false;
let hydrated = false;
const listeners = new Set<(value: boolean) => void>();

/**
 * Reads the persisted toggle into memory. Called once at app start so that the
 * synchronous `isSmartReplyEnabled()` used during render is accurate; before
 * this resolves it reports `false`, which is the safe direction to be wrong in.
 */
export async function hydrateSmartReply(): Promise<boolean> {
  if (hydrated) return enabled;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    enabled = raw === '1';
  } catch (e) {
    console.warn('[Flyer/smartreply] could not read setting, staying off', e);
    enabled = false;
  }
  hydrated = true;
  emit();
  return enabled;
}

export function isSmartReplyEnabled(): boolean {
  return enabled;
}

export async function setSmartReplyEnabled(value: boolean): Promise<void> {
  enabled = value;
  hydrated = true;
  emit();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch (e) {
    // The switch already moved; losing the write only costs the preference on
    // next launch, and the default it falls back to is the private one.
    console.warn('[Flyer/smartreply] could not persist setting', e);
  }
}

export function subscribeSmartReply(cb: (value: boolean) => void): () => void {
  listeners.add(cb);
  cb(enabled);
  return () => {
    listeners.delete(cb);
  };
}

function emit() {
  for (const cb of listeners) {
    try {
      cb(enabled);
    } catch (e) {
      console.warn('[Flyer/smartreply] listener threw', e);
    }
  }
}

/**
 * Turns the tail of a conversation into the compact transcript the function
 * forwards to Mistral.
 *
 * Deliberately text-only: media URLs are Cloudinary links that would leak the
 * user's asset paths to a third party and mean nothing to the model anyway, so
 * they go across as a bare `[photo]` / `[video]` / `[voice note]` label.
 */
function buildTranscript(messages: Message[], myUid: string) {
  const recent = messages
    .filter((m) => !m.deleted && !m.pending && !m.failed)
    .slice(-CONTEXT_MESSAGES);

  return recent
    .map((m) => {
      let content = m.text?.trim() ?? '';
      if (!content) {
        if (m.type === 'image') content = '[photo]';
        else if (m.type === 'video') content = '[video]';
        else if (m.type === 'audio') content = '[voice note]';
      }
      return {
        role: m.senderId === myUid ? ('me' as const) : ('them' as const),
        content: content.slice(0, 500),
      };
    })
    .filter((m) => m.content.length > 0);
}

/**
 * Asks for up to three short replies to the current conversation.
 *
 * Returns `[]` — never throws — when the toggle is off, when there is nothing
 * worth replying to, or when anything at all goes wrong upstream.
 */
export async function fetchSuggestions(
  chatId: string,
  messages: Message[],
  myUid: string
): Promise<string[]> {
  if (!enabled) return [];

  const transcript = buildTranscript(messages, myUid);
  if (transcript.length === 0) return [];

  // Nothing to suggest when the last word was ours — that is a conversation
  // waiting on them, and offering "reply" options to your own message is noise.
  if (transcript[transcript.length - 1].role === 'me') return [];

  try {
    const call = functions().httpsCallable('smartReply', {
      timeout: REQUEST_TIMEOUT_MS,
    });
    const response = await call({ chatId, messages: transcript });

    const raw = (response?.data as { suggestions?: unknown })?.suggestions;
    if (!Array.isArray(raw)) return [];

    const seen = new Set<string>();
    const out: string[] = [];

    for (const item of raw) {
      if (typeof item !== 'string') continue;
      // Models like to wrap suggestions in quotes or number them; strip both.
      const cleaned = item
        .trim()
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^["'`]|["'`]$/g, '')
        .trim();

      if (!cleaned || cleaned.length > MAX_SUGGESTION_CHARS) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      out.push(cleaned);
      if (out.length >= MAX_SUGGESTIONS) break;
    }

    return out;
  } catch (e) {
    console.warn('[Flyer/smartreply] suggestion request failed', e);
    return [];
  }
}
