import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  registerGlobals,
  type MediaStream,
  type MediaStreamTrack,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import { Ice, Limits } from '@/src/config/env';

// Installs RTCPeerConnection & friends onto global, which the adapter-style
// code paths inside react-native-webrtc expect.
registerGlobals();

/**
 * react-native-webrtc's own `RTCSessionDescriptionInit` (sdp is required, type
 * is a plain string) is not re-exported from the package index, and it is NOT
 * interchangeable with the DOM's identically-named type that lib.dom pulls in
 * via expo/tsconfig.base — there `sdp` is optional. Declaring it locally keeps
 * the two apart instead of casting at every call site.
 */
export interface SdpInit {
  type: string;
  sdp: string;
}

/**
 * Audio processing constraints. libwebrtc honours all three (Android forwards
 * every key straight through as a mandatory MediaConstraint, iOS the same), but
 * the library's `MediaTrackConstraints` only declares the video-shaped fields,
 * so the object needs a type of its own to survive getUserMedia's signature.
 */
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Derived from the public API surface rather than imported from
 * `react-native-webrtc/lib/typescript/...`, since the constraint types are not
 * re-exported from the package index and a deep import would break on any
 * internal reshuffle.
 */
type UserMediaConstraints = NonNullable<Parameters<typeof mediaDevices.getUserMedia>[0]>;
type AudioConstraints = UserMediaConstraints['audio'];

export type ConnectionPhase =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed';

export interface WebRTCCallbacks {
  onLocalStream: (stream: MediaStream) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onPhaseChange: (phase: ConnectionPhase) => void;
  /** Fired when reconnection has definitively failed and the call is dead. */
  onFatal: (reason: string) => void;
}

/**
 * WebRTCManager — one instance per call.
 *
 * Responsibilities are deliberately narrow: media capture, the peer connection,
 * and recovery. It knows nothing about Firebase; CallManager owns signalling and
 * feeds SDP/candidates in and out.
 */
export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private cb: WebRTCCallbacks;
  private isVideo: boolean;
  private polite: boolean;

  /**
   * Candidates that arrive before setRemoteDescription. Adding one early throws
   * and silently kills connectivity, which shows up as a call that rings, is
   * answered, and then stays black — so we buffer instead.
   */
  private pendingCandidates: RTCIceCandidate[] = [];
  private remoteDescriptionSet = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private closed = false;

  constructor(opts: { video: boolean; polite: boolean; callbacks: WebRTCCallbacks }) {
    this.isVideo = opts.video;
    this.polite = opts.polite;
    this.cb = opts.callbacks;
  }

  // --- setup -------------------------------------------------------------

  async initialize(): Promise<MediaStream> {
    const stream = await mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS as AudioConstraints,
      video: this.isVideo
        ? {
            width: { min: 480, ideal: 1280 },
            height: { min: 360, ideal: 720 },
            frameRate: { min: 15, ideal: 30 },
            facingMode: 'user',
          }
        : false,
    });

    this.localStream = stream;
    this.cb.onLocalStream(stream);

    const pc = new RTCPeerConnection(Ice);
    this.pc = pc;

    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    this.attachListeners(pc);

    // Route audio: earpiece for voice, speaker for video (matches every other
    // calling app, and video calls are held away from the face).
    InCallManager.start({ media: 'audio' });
    InCallManager.setForceSpeakerphoneOn(this.isVideo);
    if (!this.isVideo) InCallManager.setKeepScreenOn(false);

    return stream;
  }

  private attachListeners(pc: RTCPeerConnection) {
    // @ts-expect-error react-native-webrtc's event types are looser than the DOM's
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) this.cb.onIceCandidate(event.candidate as RTCIceCandidate);
    });

    // @ts-expect-error see above
    pc.addEventListener('track', (event) => {
      const [stream] = event.streams ?? [];
      if (!stream) return;
      this.remoteStream = stream as MediaStream;
      this.cb.onRemoteStream(stream as MediaStream);
    });

    // @ts-expect-error see above
    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;

      switch (state) {
        case 'connected':
          this.restartAttempts = 0;
          this.clearReconnectTimer();
          this.cb.onPhaseChange('connected');
          break;

        case 'connecting':
          this.cb.onPhaseChange('connecting');
          break;

        case 'disconnected':
          // 'disconnected' is frequently transient (a WiFi/LTE handover). Give
          // ICE a grace period to recover on its own before forcing a restart.
          this.cb.onPhaseChange('reconnecting');
          this.scheduleReconnect();
          break;

        case 'failed':
          this.cb.onPhaseChange('reconnecting');
          void this.restartIce();
          break;

        case 'closed':
          this.cb.onPhaseChange('closed');
          break;
      }
    });
  }

  // --- negotiation -------------------------------------------------------

  async createOffer(iceRestart = false): Promise<RTCSessionDescription> {
    const pc = this.requirePc();
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.isVideo,
      iceRestart,
    });
    await pc.setLocalDescription(offer);
    return offer as RTCSessionDescription;
  }

  async createAnswer(): Promise<RTCSessionDescription> {
    const pc = this.requirePc();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer as RTCSessionDescription;
  }

  async setRemoteDescription(description: SdpInit): Promise<void> {
    const pc = this.requirePc();

    // Glare handling: if both sides offered simultaneously, the "polite" peer
    // rolls back its own offer rather than both failing.
    const offerCollision =
      description.type === 'offer' && pc.signalingState !== 'stable';

    if (offerCollision) {
      if (!this.polite) {
        console.warn('[Flyer/rtc] ignoring colliding offer (impolite peer)');
        return;
      }
      // A rollback carries no SDP, but the library's type requires the field.
      await pc.setLocalDescription({ type: 'rollback', sdp: '' });
    }

    await pc.setRemoteDescription(new RTCSessionDescription(description));
    this.remoteDescriptionSet = true;

    for (const candidate of this.pendingCandidates) {
      await pc.addIceCandidate(candidate).catch((e) => {
        console.warn('[Flyer/rtc] buffered candidate rejected', e);
      });
    }
    this.pendingCandidates = [];
  }

  async addIceCandidate(init: RTCIceCandidateInit): Promise<void> {
    const candidate = new RTCIceCandidate(init);

    if (!this.remoteDescriptionSet || !this.pc) {
      this.pendingCandidates.push(candidate);
      return;
    }

    await this.pc.addIceCandidate(candidate).catch((e) => {
      console.warn('[Flyer/rtc] addIceCandidate failed', e);
    });
  }

  // --- recovery ----------------------------------------------------------

  private scheduleReconnect() {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (this.closed) return;
      if (this.pc?.connectionState === 'connected') return;
      void this.restartIce();
    }, Limits.reconnectGraceMs);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Only the offerer may restart ICE; the answerer waits for the new offer.
   * `onRenegotiationNeeded` is wired by CallManager, which republishes the SDP.
   */
  private onRestartNeeded: ((offer: RTCSessionDescription) => Promise<void>) | null = null;

  setRestartHandler(fn: (offer: RTCSessionDescription) => Promise<void>) {
    this.onRestartNeeded = fn;
  }

  async restartIce(): Promise<void> {
    if (this.closed || !this.pc) return;

    this.restartAttempts += 1;
    if (this.restartAttempts > 3) {
      this.cb.onFatal('Could not restore the connection');
      return;
    }

    if (!this.onRestartNeeded) return;

    try {
      const offer = await this.createOffer(true);
      await this.onRestartNeeded(offer);
    } catch (e) {
      console.warn('[Flyer/rtc] ICE restart failed', e);
      this.scheduleReconnect();
    }
  }

  // --- controls ----------------------------------------------------------

  setMicMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t: MediaStreamTrack) => {
      t.enabled = !muted;
    });
    InCallManager.setMicrophoneMute(muted);
  }

  setVideoEnabled(enabled: boolean) {
    this.localStream?.getVideoTracks().forEach((t: MediaStreamTrack) => {
      t.enabled = enabled;
    });
  }

  setSpeaker(on: boolean) {
    InCallManager.setForceSpeakerphoneOn(on);
  }

  async switchCamera(): Promise<void> {
    const [track] = this.localStream?.getVideoTracks() ?? [];
    if (!track) return;
    // react-native-webrtc extends MediaStreamTrack with _switchCamera.
    (track as MediaStreamTrack & { _switchCamera?: () => void })._switchCamera?.();
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  /** Round-trip time and packet loss, for the "poor connection" banner. */
  async readStats(): Promise<{ rttMs: number | null; packetsLost: number }> {
    if (!this.pc) return { rttMs: null, packetsLost: 0 };
    try {
      const report = await this.pc.getStats();
      let rttMs: number | null = null;
      let packetsLost = 0;

      report.forEach((entry: Record<string, unknown>) => {
        if (entry.type === 'candidate-pair' && entry.state === 'succeeded') {
          const rtt = entry.currentRoundTripTime as number | undefined;
          if (typeof rtt === 'number') rttMs = Math.round(rtt * 1000);
        }
        if (entry.type === 'inbound-rtp') {
          packetsLost += (entry.packetsLost as number) ?? 0;
        }
      });

      return { rttMs, packetsLost };
    } catch {
      return { rttMs: null, packetsLost: 0 };
    }
  }

  // --- teardown ----------------------------------------------------------

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearReconnectTimer();

    // Stopping tracks is what actually releases the camera and mic. Skipping
    // this leaves the camera LED on after the call ends.
    this.localStream?.getTracks().forEach((t: MediaStreamTrack) => {
      t.stop();
    });
    this.remoteStream?.getTracks().forEach((t: MediaStreamTrack) => {
      t.stop();
    });

    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }

    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.pendingCandidates = [];

    InCallManager.stop();
    InCallManager.setKeepScreenOn(false);
  }

  private requirePc(): RTCPeerConnection {
    if (!this.pc) throw new Error('WebRTCManager used before initialize()');
    return this.pc;
  }
}
