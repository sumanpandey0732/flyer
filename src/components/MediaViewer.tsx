import React from 'react';
import { Modal, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { ResizeMode, Video } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Message } from '@/src/config/types';
import { useAppStore } from '@/src/services/StateManager';
import { dayLabel, formatClock } from '@/src/services/ChatEngine';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  message: Message | null;
  onClose: () => void;
}

/**
 * Full-screen media viewer.
 *
 * Always renders on black regardless of theme — a photo viewer with light chrome
 * behind it washes out the image, and both platforms' native viewers do the same.
 * These two literals are therefore intentional rather than theme tokens.
 */
const VIEWER_FG = '#FFFFFF';
const VIEWER_FG_DIM = 'rgba(255,255,255,0.65)';

export function MediaViewer({ message, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const myUid = useAppStore((s) => s.currentUser?.uid);
  const senderName = useAppStore((s) =>
    message ? (s.users[message.senderId]?.name ?? null) : null
  );

  const title = message
    ? message.senderId === myUid
      ? 'You'
      : (senderName ?? 'Unknown')
    : '';
  const subtitle = message
    ? `${dayLabel(message.timestamp)} at ${formatClock(message.timestamp)}`
    : '';

  return (
    <Modal
      visible={Boolean(message)}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={onClose} round={42} accessibilityLabel="Close media viewer">
            <Icon name="close" size={20} color={VIEWER_FG} />
          </Pressable>

          <View style={styles.headerTitles}>
            <Text style={[styles.headerText]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.headerSubtitle]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          {!message || !message.mediaUrl ? (
            <View style={styles.unavailable}>
              <Icon name="warning" size={30} color={VIEWER_FG_DIM} />
              <Text style={styles.unavailableText}>This media is no longer available</Text>
            </View>
          ) : message.type === 'video' ? (
            <Video
              source={{ uri: message.mediaUrl }}
              style={styles.media}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping={false}
            />
          ) : (
            <Image
              source={{ uri: message.mediaUrl }}
              style={styles.media}
              contentFit="contain"
              transition={140}
              cachePolicy="memory-disk"
              accessibilityLabel="Full screen image"
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  headerTitles: { flex: 1 },
  headerText: { color: VIEWER_FG, fontSize: 15, fontWeight: '600' },
  headerSubtitle: { color: VIEWER_FG_DIM, fontSize: 12, marginTop: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '100%' },
  unavailable: { alignItems: 'center', gap: 10, paddingHorizontal: 32 },
  unavailableText: { color: VIEWER_FG_DIM, fontSize: 14, textAlign: 'center' },
});
