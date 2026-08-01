import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useTheme } from '@/src/theme/ThemeProvider';
import { formatDuration } from '@/src/services/MediaManager';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

/**
 * Voice-note player.
 *
 * expo-av allows several sounds to play at once, which sounds like chaos when a
 * user taps through a run of voice notes. This module-level handle enforces one
 * at a time.
 */
let activeSound: { id: string; stop: () => Promise<void> } | null = null;

interface Props {
  uri: string;
  durationMs: number | null;
  messageId: string;
  tint: string;
  trackColor: string;
  /** Deterministic bar heights so the same note always looks the same. */
  seed: string;
}

const BAR_COUNT = 28;

function barsFor(seed: string): number[] {
  const bars: number[] = [];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 1000003;
  }
  for (let i = 0; i < BAR_COUNT; i += 1) {
    hash = (hash * 1103515245 + 12345) % 2147483648;
    bars.push(0.25 + ((hash % 100) / 100) * 0.75);
  }
  return bars;
}

export function AudioPlayer({ uri, durationMs, messageId, tint, trackColor, seed }: Props) {
  const theme = useTheme();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [totalMs, setTotalMs] = useState(durationMs ?? 0);

  const bars = useRef(barsFor(seed)).current;

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      if (activeSound?.id === messageId) activeSound = null;
    };
  }, [messageId]);

  const onStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPositionMs(status.positionMillis ?? 0);
    if (status.durationMillis) setTotalMs(status.durationMillis);

    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
    }
  };

  const toggle = async () => {
    try {
      if (playing) {
        await soundRef.current?.pauseAsync();
        setPlaying(false);
        return;
      }

      // Stop whatever else is playing first.
      if (activeSound && activeSound.id !== messageId) {
        await activeSound.stop().catch(() => {});
      }

      if (!soundRef.current) {
        setLoading(true);
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });

        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true, progressUpdateIntervalMillis: 100 },
          onStatus
        );
        soundRef.current = sound;
        setLoading(false);
      } else {
        await soundRef.current.playAsync();
      }

      setPlaying(true);
      activeSound = {
        id: messageId,
        stop: async () => {
          await soundRef.current?.pauseAsync().catch(() => {});
          setPlaying(false);
        },
      };
    } catch (e) {
      console.warn('[Flyer/audio] playback failed', e);
      setLoading(false);
      setPlaying(false);
    }
  };

  const progress = totalMs > 0 ? Math.min(1, positionMs / totalMs) : 0;
  const playedBars = Math.round(progress * BAR_COUNT);
  const remaining = totalMs > 0 ? totalMs - positionMs : (durationMs ?? 0);

  return (
    <View style={styles.row}>
      <Pressable onPress={toggle} round={38} style={{ backgroundColor: 'transparent' }}>
        <Icon
          name={loading ? 'clock' : playing ? 'pause' : 'play'}
          size={loading ? 16 : 18}
          color={tint}
        />
      </Pressable>

      <View style={styles.waveform}>
        {bars.map((height, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: Math.max(3, height * 22),
                backgroundColor: i < playedBars ? tint : trackColor,
              },
            ]}
          />
        ))}
      </View>

      <Text style={[styles.time, { color: theme.colors.textMuted }]}>
        {formatDuration(playing || positionMs > 0 ? remaining : (durationMs ?? 0))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 210, gap: 4 },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 26,
  },
  bar: { flex: 1, borderRadius: 2, minWidth: 2 },
  time: { fontSize: 11, minWidth: 34, textAlign: 'right' },
});
