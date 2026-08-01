import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import messaging from '@react-native-firebase/messaging';

/**
 * PermissionManager
 *
 * Every permission the app needs, behind one API that always resolves to a
 * tri-state. Callers must distinguish `blocked` from `denied`: a blocked
 * permission cannot be re-requested from JS and the only recovery is deep
 * linking into system settings.
 */

export type PermissionResult = 'granted' | 'denied' | 'blocked';

export type PermissionName =
  | 'camera'
  | 'microphone'
  | 'notifications'
  | 'mediaLibrary';

function fromExpoStatus(res: {
  status: string;
  canAskAgain?: boolean;
}): PermissionResult {
  if (res.status === 'granted') return 'granted';
  if (res.canAskAgain === false) return 'blocked';
  return 'denied';
}

async function requestCamera(): Promise<PermissionResult> {
  const res = await ImagePicker.requestCameraPermissionsAsync();
  return fromExpoStatus(res);
}

async function requestMicrophone(): Promise<PermissionResult> {
  const res = await Audio.requestPermissionsAsync();
  return fromExpoStatus(res);
}

async function requestMediaLibrary(): Promise<PermissionResult> {
  const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return fromExpoStatus(res);
}

async function requestNotifications(): Promise<PermissionResult> {
  if (Platform.OS === 'android') {
    // POST_NOTIFICATIONS only exists on API 33+. On older releases the
    // permission is implicitly granted and the request resolves to 'denied',
    // so short-circuit rather than showing a false failure state.
    if (typeof Platform.Version === 'number' && Platform.Version < 33) return 'granted';

    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    if (res === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    if (res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
    return 'denied';
  }

  const status = await messaging().requestPermission({
    alert: true,
    badge: true,
    sound: true,
    // Lets iOS deliver call pushes without a banner while the app is alive.
    provisional: false,
  });

  const enabled =
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL;

  if (enabled) return 'granted';
  return status === messaging.AuthorizationStatus.DENIED ? 'blocked' : 'denied';
}

export async function request(name: PermissionName): Promise<PermissionResult> {
  try {
    switch (name) {
      case 'camera':
        return await requestCamera();
      case 'microphone':
        return await requestMicrophone();
      case 'mediaLibrary':
        return await requestMediaLibrary();
      case 'notifications':
        return await requestNotifications();
    }
  } catch (e) {
    console.warn(`[Flyer/permissions] ${name} request threw`, e);
    return 'denied';
  }
}

export async function check(name: PermissionName): Promise<PermissionResult> {
  try {
    switch (name) {
      case 'camera':
        return fromExpoStatus(await ImagePicker.getCameraPermissionsAsync());
      case 'microphone':
        return fromExpoStatus(await Audio.getPermissionsAsync());
      case 'mediaLibrary':
        return fromExpoStatus(await ImagePicker.getMediaLibraryPermissionsAsync());
      case 'notifications': {
        const status = await messaging().hasPermission();
        return status === messaging.AuthorizationStatus.AUTHORIZED ||
          status === messaging.AuthorizationStatus.PROVISIONAL
          ? 'granted'
          : status === messaging.AuthorizationStatus.DENIED
            ? 'blocked'
            : 'denied';
      }
    }
  } catch {
    return 'denied';
  }
}

/**
 * A call needs mic (always) and camera (video only) before we touch getUserMedia
 * — requesting them mid-negotiation produces a black/silent call that looks like
 * a WebRTC bug.
 */
export async function ensureCallPermissions(
  video: boolean
): Promise<{ ok: boolean; missing: PermissionName[]; blocked: boolean }> {
  const needed: PermissionName[] = video ? ['microphone', 'camera'] : ['microphone'];
  const missing: PermissionName[] = [];
  let blocked = false;

  for (const name of needed) {
    let result = await check(name);
    if (result !== 'granted') result = await request(name);
    if (result !== 'granted') {
      missing.push(name);
      if (result === 'blocked') blocked = true;
    }
  }

  return { ok: missing.length === 0, missing, blocked };
}

/** Requested once after login, non-blocking. */
export async function requestStartupPermissions(): Promise<
  Record<PermissionName, PermissionResult>
> {
  const notifications = await request('notifications');
  return {
    notifications,
    camera: await check('camera'),
    microphone: await check('microphone'),
    mediaLibrary: await check('mediaLibrary'),
  };
}

export function openSettings() {
  Linking.openSettings().catch(() => {
    Linking.openURL('app-settings:').catch(() => {});
  });
}

export const PERMISSION_COPY: Record<PermissionName, { title: string; body: string }> = {
  camera: {
    title: 'Camera access needed',
    body: 'Flyer needs the camera for video calls and to capture photos you send.',
  },
  microphone: {
    title: 'Microphone access needed',
    body: 'Flyer needs the microphone for calls and voice notes.',
  },
  notifications: {
    title: 'Notifications are off',
    body: 'Without notifications you will not be told about new messages, and incoming calls will not ring when Flyer is closed.',
  },
  mediaLibrary: {
    title: 'Photo access needed',
    body: 'Flyer needs access to your photos so you can send images and videos.',
  },
};
