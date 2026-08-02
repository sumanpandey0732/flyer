import { useEffect, useState } from 'react';
import { AudioRouteManager, type AudioRouteState } from '@/src/services/AudioRoute';

/**
 * Subscribe to the live audio-device list.
 *
 * The controller holds the state so it survives this screen remounting mid-call
 * (which happens when the app is backgrounded and restored), and `subscribe`
 * replays the current value immediately — so there is no frame where the picker
 * renders as if no devices exist.
 */
export function useAudioRoutes(): AudioRouteState & { supported: boolean } {
  const [state, setState] = useState<AudioRouteState>(() => AudioRouteManager.getState());

  useEffect(() => AudioRouteManager.subscribe(setState), []);

  return { ...state, supported: AudioRouteManager.supported };
}
