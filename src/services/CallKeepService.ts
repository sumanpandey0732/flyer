import { Platform } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import * as Crypto from 'expo-crypto';

/**
 * CallKeepService — the bridge to the OS telephony stack.
 *
 * Android: registers a self-managed-adjacent ConnectionService so incoming calls
 * ring with the system call UI over the lock screen, even from a cold start.
 * iOS: CallKit, with the caveat below.
 *
 * ── iOS limitation, stated plainly ──────────────────────────────────────────
 * CallKit's full-screen incoming UI on a *terminated* app requires a PushKit
 * VoIP push. FCM cannot send PushKit pushes (it only speaks to APNs' standard
 * alert/background channels), so on iOS this service can only present CallKit
 * while the app is running or suspended-but-alive. When iOS has terminated the
 * app, the caller's invite arrives as a normal notification and the callee must
 * tap it. Closing that gap requires sending VoIP pushes straight to APNs with an
 * Apple VoIP key — see README "iOS calling".
 * Android has no such restriction: the data-only FCM message wakes the process
 * and this service rings properly from fully closed.
 */

export type CallKeepEvent =
  | { type: 'answer'; callId: string }
  | { type: 'end'; callId: string }
  | { type: 'mute'; callId: string; muted: boolean }
  | { type: 'hold'; callId: string; held: boolean }
  | { type: 'audioSessionActivated' };

type Listener = (event: CallKeepEvent) => void;

let listeners: Listener[] = [];
let setupDone = false;
let setupPromise: Promise<boolean> | null = null;

/** CallKit requires an RFC-4122 UUID; Firebase push keys are not valid here. */
export function newCallId(): string {
  return Crypto.randomUUID();
}

function emit(event: CallKeepEvent) {
  for (const l of [...listeners]) {
    try {
      l(event);
    } catch (e) {
      console.warn('[Flyer/callkeep] listener threw', e);
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/**
 * Safe to call repeatedly and from the FCM background handler — the first call
 * wins and later callers await the same promise. Setting up twice on Android
 * duplicates the phone account and the second incoming call silently fails.
 */
export async function setup(): Promise<boolean> {
  if (setupDone) return true;
  if (setupPromise) return setupPromise;

  setupPromise = (async () => {
    try {
      await RNCallKeep.setup({
        ios: {
          appName: 'Flyer',
          supportsVideo: true,
          maximumCallGroups: '1',
          maximumCallsPerCallGroup: '1',
          includesCallsInRecents: true,
        },
        android: {
          alertTitle: 'Phone account permission',
          alertDescription:
            'Flyer needs to register a calling account so calls can ring on your lock screen.',
          cancelButton: 'Not now',
          okButton: 'Allow',
          additionalPermissions: [],
          // The foreground service is what keeps the call alive when the user
          // swipes the app away mid-call.
          foregroundService: {
            channelId: 'com.flyer.chat.calls',
            channelName: 'Flyer calls',
            notificationTitle: 'Flyer call in progress',
            notificationIcon: 'ic_launcher',
          },
          // Self-managed mode would hand us full UI control but loses the
          // system lock-screen call UI, which is the whole point here.
          selfManaged: false,
        },
      });

      if (Platform.OS === 'android') {
        RNCallKeep.setAvailable(true);
        RNCallKeep.canMakeMultipleCalls(false);
      }

      attachNativeListeners();
      setupDone = true;
      return true;
    } catch (e) {
      console.warn('[Flyer/callkeep] setup failed', e);
      setupPromise = null;
      return false;
    }
  })();

  return setupPromise;
}

let nativeListenersAttached = false;

function attachNativeListeners() {
  if (nativeListenersAttached) return;
  nativeListenersAttached = true;

  RNCallKeep.addEventListener('answerCall', ({ callUUID }) => {
    // On Android the activity may still be behind the lock screen.
    if (Platform.OS === 'android') RNCallKeep.backToForeground();
    emit({ type: 'answer', callId: callUUID.toLowerCase() });
  });

  RNCallKeep.addEventListener('endCall', ({ callUUID }) => {
    emit({ type: 'end', callId: callUUID.toLowerCase() });
  });

  RNCallKeep.addEventListener('didPerformSetMutedCallAction', ({ callUUID, muted }) => {
    emit({ type: 'mute', callId: callUUID.toLowerCase(), muted });
  });

  RNCallKeep.addEventListener('didToggleHoldCallAction', ({ callUUID, hold }) => {
    emit({ type: 'hold', callId: callUUID.toLowerCase(), held: hold });
  });

  RNCallKeep.addEventListener('didActivateAudioSession', () => {
    emit({ type: 'audioSessionActivated' });
  });

  /**
   * Critical for the cold-start path: if the user answers from the native UI
   * before React has mounted, the answerCall event fires with nobody listening.
   * callkeep replays those events here.
   */
  RNCallKeep.addEventListener('didLoadWithEvents', (events) => {
    for (const event of events ?? []) {
      if (event.name === 'RNCallKeepPerformAnswerCallAction') {
        emit({ type: 'answer', callId: String(event.data.callUUID).toLowerCase() });
      }
      if (event.name === 'RNCallKeepPerformEndCallAction') {
        emit({ type: 'end', callId: String(event.data.callUUID).toLowerCase() });
      }
    }
  });
}

// --- actions --------------------------------------------------------------

export async function displayIncoming(opts: {
  callId: string;
  callerName: string;
  callerHandle: string;
  hasVideo: boolean;
}): Promise<void> {
  await setup();
  RNCallKeep.displayIncomingCall(
    opts.callId,
    opts.callerHandle,
    opts.callerName,
    'generic',
    opts.hasVideo
  );
}

export async function startOutgoing(opts: {
  callId: string;
  calleeName: string;
  calleeHandle: string;
  hasVideo: boolean;
}): Promise<void> {
  await setup();
  RNCallKeep.startCall(opts.callId, opts.calleeHandle, opts.calleeName, 'generic', opts.hasVideo);
}

/** Tells the OS the call connected, which starts the system call timer. */
export function reportConnected(callId: string) {
  RNCallKeep.setCurrentCallActive(callId);
}

export function reportOutgoingRinging(callId: string) {
  RNCallKeep.reportConnectingOutgoingCallWithUUID(callId);
  RNCallKeep.reportConnectedOutgoingCallWithUUID(callId);
}

export type EndReason = 'missed' | 'declined' | 'remote' | 'failed' | 'local';

const END_REASON_CODE: Record<EndReason, number> = {
  // CallKit CXCallEndedReason values; callkeep maps these on Android too.
  failed: 1, // failed
  remote: 2, // remoteEnded
  missed: 3, // unanswered
  declined: 6, // declinedElsewhere -> shows as declined
  local: 2,
};

export function endCall(callId: string, reason: EndReason = 'local') {
  try {
    if (reason === 'local') {
      RNCallKeep.endCall(callId);
    } else {
      RNCallKeep.reportEndCallWithUUID(callId, END_REASON_CODE[reason]);
    }
  } catch (e) {
    console.warn('[Flyer/callkeep] endCall failed', e);
  }
}

export function endAll() {
  try {
    RNCallKeep.endAllCalls();
  } catch {
    /* nothing to end */
  }
}

export function setMuted(callId: string, muted: boolean) {
  RNCallKeep.setMutedCall(callId, muted);
}

export function updateDisplay(callId: string, name: string, handle: string) {
  RNCallKeep.updateDisplay(callId, name, handle);
}

/** Android only; no-op elsewhere. Brings the activity up over the keyguard. */
export function toForeground() {
  if (Platform.OS === 'android') RNCallKeep.backToForeground();
}
