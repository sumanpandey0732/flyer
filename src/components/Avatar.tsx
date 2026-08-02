import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { avatarColor, initialsOf } from '@/src/theme/theme';
import { useTheme } from '@/src/theme/ThemeProvider';
import { thumbUrl } from '@/src/services/MediaManager';
import { Icon } from './Icon';

interface Props {
  uri?: string | null;
  name: string;
  uid: string;
  size?: number;
  online?: boolean;
  /** Suppresses the photo when the peer's privacy setting hides it. */
  showPhoto?: boolean;
  /**
   * Groups fall back to a people glyph rather than initials: "WE" for "Weekend
   * Errands" reads like a person's monogram, which is the wrong signal.
   */
  group?: boolean;
}

export function Avatar({
  uri,
  name,
  uid,
  size = 48,
  online,
  showPhoto = true,
  group = false,
}: Props) {
  const theme = useTheme();
  const visible = showPhoto && uri;

  // Google photo urls are already small; only Cloudinary uploads need resizing.
  const source = visible
    ? uri.includes('res.cloudinary.com')
      ? thumbUrl(uri, size * 3)
      : uri
    : null;

  return (
    <View style={{ width: size, height: size }}>
      {source ? (
        <Image
          source={{ uri: source }}
          style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          style={[
            styles.fallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: avatarColor(uid || name),
            },
          ]}
        >
          {group ? (
            <Icon name="people" size={size * 0.52} color="#FFFFFF" />
          ) : (
            <Text style={[styles.initials, { fontSize: size * 0.36 }]}>
              {initialsOf(name)}
            </Text>
          )}
        </View>
      )}

      {online ? (
        <View
          style={[
            styles.dot,
            {
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: size * 0.14,
              backgroundColor: theme.colors.success,
              borderColor: theme.colors.bg,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: 'rgba(127,127,127,0.2)' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#FFFFFF', fontWeight: '600' },
  dot: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2 },
});
