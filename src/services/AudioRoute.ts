import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

/**
 * In-call audio routing.
 *
 * `setForceSpeakerphoneOn` is a two-state switch, which is enough for a speaker
 * button and nothing else — the moment a Bluetooth headset is paired the user
 * needs a third choice, and forcing the speaker actively fights the headset.
 * `chooseAudioRoute` is the four-state API underneath it, so this module drives
 * that instead and keeps the speaker toggle as a shortcut over the same
 * mechanism.
 *
 * Device availability is discovered natively, not guessed: InCallManager emits
 * `onAudioDeviceChanged` whenever a headset is plugged, unplugged, connected or
 * disconnected, carrying the full list. Polling would miss the window where a
 * headset connects mid-call, which is the case that matters most.
 */

export type AudioRoute = 'EARPIECE' | 'SPEAKER_PHONE' | 'BLUETOOTH' | 'WIRED_HEADSET';

export interface AudioRouteState {
  /** Everything the OS will currently accept. Ordered for display. */
  available: AudioRoute[];
  /** What audio is going through right now, or null before the first report. */
  selected: AudioRoute | null;
}

/** Display order, most-private first — the order WhatsApp's own picker uses. */
const ORDER: AudioRoute[] = ['EARPIECE', 'WIRED_HEADSET', 'BLUETOOTH', 'SPEAKER_PHONE'];

const LABELS: Record<AudioRoute, string> = {
  EARPIECE: 'Phone',
  SPEAKER_PHONE: 'Speaker',
  BLUETOOTH: 'Bluetooth',
  WIRED_HEADSET: 'Headset',
};

export function routeLabel(route: AudioRoute): string {
  return LABELS[route];
}

/**
 * The native payload. `availableAudioDeviceList` arrives as a JSON *string*
 * rather than an array — the Android module builds it by string concatenation —
 * so it has to be parsed rather than used directly.
 */
interface NativePayload {
  availableAudioDeviceList?: string;
  selectedAudioDevice?: string;
}

function isRoute(value: string): value is AudioRoute {
  return value === 'EARPIECE' || value === 'SPEAKER_PHONE' || value === 'BLUETOOTH' || value === 'WIRED_HEADSET';
}

function parsePayload(payload: NativePayload): AudioRouteState {
  let list: string[] = [];
  try {
    const parsed = JSON.parse(payload.availableAudioDeviceList ?? '[]');
    if (Array.isArray(parsed)) list = parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    // A malformed list is not worth failing a call over; treat it as unknown
    // and let the speaker toggle carry on working.
    list = [];
  }

  const available = ORDER.filter((r) => list.includes(r));
  const selectedRaw = payload.selectedAudioDevice ?? '';

  return {
    available,
    selected: isRoute(selectedRaw) ? selectedRaw : null,
  };
}

type Listener = (state: AudioRouteState) => void;

class AudioRouteController {
  private listeners = new Set<Listener>();
  private emitter: NativeEventEmitter | null = null;
  private subscription: { remove(): void } | null = null;

  private state: AudioRouteState = { available: [], selected: null };

  /**
   * iOS has no equivalent event and routes audio itself through the audio
   * session, so the picker is Android-only. On iOS the speaker toggle remains
   * the whole story, and the system route picker in Control Centre handles
   * Bluetooth — which is the platform-idiomatic behaviour anyway.
   */
  get supported(): boolean {
    return Platform.OS === 'android';
  }

  getState(): AudioRouteState {
    return this.state;
  }

  /** Call once the peer connection is up. Safe to call twice. */
  start() {
    if (!this.supported || this.subscription) return;

    try {
      this.emitter = new NativeEventEmitter(NativeModules.InCallManager);
      this.subscription = this.emitter.addListener('onAudioDeviceChanged', (payload: NativePayload) => {
        this.state = parsePayload(payload);
        this.listeners.forEach((fn) => fn(this.state));
      });
    } catch (e) {
      console.warn('[Flyer/audio] could not observe audio devices', e);
    }
  }

  stop() {
    this.subscription?.remove();
    this.subscription = null;
    this.emitter = null;
    this.state = { available: [], selected: null };
    this.listeners.forEach((fn) => fn(this.state));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Switch route. The optimistic local update is what keeps the button from
   * lagging: the native confirmation event lands a frame or two later and
   * overwrites this with the truth, including when the OS refuses.
   */
  async select(route: AudioRoute): Promise<void> {
    if (!this.supported) {
      // iOS: only the speaker distinction is expressible.
      InCallManager.setForceSpeakerphoneOn(route === 'SPEAKER_PHONE');
      this.state = { ...this.state, selected: route };
      this.listeners.forEach((fn) => fn(this.state));
      return;
    }

    this.state = { ...this.state, selected: route };
    this.listeners.forEach((fn) => fn(this.state));

    try {
      await InCallManager.chooseAudioRoute(route);
    } catch (e) {
      console.warn('[Flyer/audio] route change rejected', route, e);
    }
  }

  /**
   * What the speaker button should do next. Turning the speaker off returns to
   * a headset when one is connected rather than the earpiece, because that is
   * where the user was listening before they turned it on.
   */
  nextForSpeakerToggle(speakerOn: boolean): AudioRoute {
    if (!speakerOn) return 'SPEAKER_PHONE';

    const { available } = this.state;
    if (available.includes('BLUETOOTH')) return 'BLUETOOTH';
    if (available.includes('WIRED_HEADSET')) return 'WIRED_HEADSET';
    return 'EARPIECE';
  }
}

export const AudioRouteManager = new AudioRouteController();
