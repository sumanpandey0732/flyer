import { AppState as RNAppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {
  Paths,
  cancelOnDisconnect,
  onDisconnectSet,
  onValue,
  serverTimestamp,
  update,
} from './FirebaseService';
import { appState } from './StateManager';

/**
 * PresenceManager
 *
 * Presence has one hard requirement: a device that dies without warning must
 * still end up marked offline. Only the server can do that, so we register an
 * onDisconnect handler and re-register it every time the socket reconnects
 * (Firebase consumes the handler when it fires).
 *
 * We deliberately watch `.info/connected` rather than NetInfo for the write
 * itself — NetInfo says "there is a network", which is not the same as "the RTDB
 * socket is up" behind a captive portal.
 */

let teardown: Array<() => void> = [];
let activeUid: string | null = null;

export function startPresence(uid: string) {
  stopPresence();
  activeUid = uid;

  const presencePath = Paths.userPresence(uid);
  const lastSeenPath = Paths.userLastSeen(uid);

  const offConnected = onValue(Paths.connected(), async (snap) => {
    const connected = snap.val() === true;

    appState.get().setNetworkStatus(connected ? 'online' : 'reconnecting');
    if (!connected) return;

    try {
      // Register the death certificate first. If we set online:true first and
      // the process is killed in between, the user is stuck "online" forever.
      await onDisconnectSet(presencePath, false);
      await onDisconnectSet(lastSeenPath, serverTimestamp());

      await update(Paths.user(uid), {
        online: true,
        lastSeen: serverTimestamp(),
      });
    } catch (e) {
      console.warn('[Flyer/presence] failed to publish presence', e);
    }
  });
  teardown.push(offConnected);

  // Foreground/background transitions. Backgrounding is a clean exit, so we can
  // write offline ourselves rather than waiting for the socket to time out.
  const sub = RNAppState.addEventListener('change', (status: AppStateStatus) => {
    if (!activeUid) return;
    const foreground = status === 'active';

    // Do not flip to offline while a call is up — the app is backgrounded but
    // the user is very much present, and the peer's UI reads this flag.
    if (!foreground && appState.get().activeCall) return;

    update(Paths.user(activeUid), {
      online: foreground,
      lastSeen: serverTimestamp(),
    }).catch(() => {
      /* offline; onDisconnect will cover it */
    });
  });
  teardown.push(() => sub.remove());

  const offNet = NetInfo.addEventListener((state) => {
    const reachable = state.isConnected === true && state.isInternetReachable !== false;
    const current = appState.get().networkStatus;
    if (!reachable) {
      appState.get().setNetworkStatus('offline');
    } else if (current === 'offline') {
      appState.get().setNetworkStatus('reconnecting');
    }
  });
  teardown.push(offNet);
}

export function stopPresence() {
  for (const fn of teardown) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  teardown = [];

  if (activeUid) {
    // Drop the handler so a later reconnect on a different account does not
    // write offline into the previous user's profile.
    cancelOnDisconnect(Paths.userPresence(activeUid)).catch(() => {});
    cancelOnDisconnect(Paths.userLastSeen(activeUid)).catch(() => {});
  }
  activeUid = null;
}

/** "online" | "last seen today at 14:03" | "last seen 12/06/2025" */
export function formatLastSeen(
  online: boolean,
  lastSeen: number,
  showLastSeen = true
): string {
  if (!showLastSeen) return '';
  if (online) return 'online';
  if (!lastSeen) return '';

  const then = new Date(lastSeen);
  const now = new Date();
  const time = then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) return `last seen today at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) {
    return `last seen yesterday at ${time}`;
  }

  return `last seen ${then.toLocaleDateString()}`;
}
