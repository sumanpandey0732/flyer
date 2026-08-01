import React from 'react';
import { Text } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import type { Message } from '@/src/config/types';

/**
 * Delivery state, WhatsApp semantics:
 *   clock  — queued locally, not yet at the server
 *   ✓      — written to the database
 *   ✓✓     — the peer has opened it
 * A failed send shows a red retry glyph instead.
 */
export function Ticks({
  message,
  peerUid,
  color,
  seenColor,
}: {
  message: Message;
  peerUid: string | null;
  color: string;
  seenColor: string;
}) {
  const theme = useTheme();

  if (message.failed) {
    return <Text style={{ fontSize: 12, color: theme.colors.danger }}>⚠</Text>;
  }
  if (message.pending) {
    return <Text style={{ fontSize: 10, color }}>🕐</Text>;
  }

  const seen = peerUid ? Boolean(message.seenBy?.[peerUid]) : false;

  return (
    <Text style={{ fontSize: 11, color: seen ? seenColor : color, letterSpacing: -2 }}>
      {seen ? '✓✓' : '✓'}
    </Text>
  );
}
