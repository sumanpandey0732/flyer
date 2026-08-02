import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

/**
 * Android picture-in-picture.
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: the module
 * only exists in a dev-client or EAS build, so a hard require would crash the
 * app in Expo Go and in the Metro bundle before a native rebuild. Every entry
 * point below degrades to "unsupported" when it is absent, which is also the
 * correct answer on iOS — see the module's Kotlin doc comment for why PiP is
 * not implemented there.
 */

interface PipNativeModule {
  isSupported(): boolean;
  isInPipMode(): boolean;
  enterPipMode(width?: number, height?: number): boolean;
  addListener(
    event: 'onPipModeChanged',
    listener: (payload: { isInPipMode: boolean }) => void
  ): EventSubscription;
}

const native = requireOptionalNativeModule<PipNativeModule>('FlyerPip');

export function isPipSupported(): boolean {
  if (Platform.OS !== 'android' || !native) return false;
  try {
    return native.isSupported();
  } catch {
    return false;
  }
}

export function isInPipMode(): boolean {
  if (!native) return false;
  try {
    return native.isInPipMode();
  } catch {
    return false;
  }
}

/**
 * Shrink the call into a floating window. Returns whether the request was
 * accepted; a false result means the device or the user's settings said no, and
 * the caller should simply stay fullscreen.
 */
export function enterPipMode(aspect?: { width: number; height: number }): boolean {
  if (!isPipSupported() || !native) return false;
  try {
    return native.enterPipMode(aspect?.width, aspect?.height);
  } catch {
    return false;
  }
}

/** Returns an unsubscribe function, or a no-op where PiP does not exist. */
export function onPipModeChanged(listener: (inPip: boolean) => void): () => void {
  if (!native) return () => {};

  try {
    const sub = native.addListener('onPipModeChanged', ({ isInPipMode: v }) => listener(v));
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
