import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import type { Message } from '@/src/config/types';
import { Icon } from './Icon';

/**
 * Delivery state, WhatsApp semantics:
 *   clock  — queued locally, not yet at the server
 *   check  — written to the database
 *   done-all — the peer has opened it (tinted)
 * A failed send shows a red warning instead; the bubble itself offers the retry.
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
    return <Icon name="warning" size={13} color={theme.colors.danger} />;
  }
  if (message.pending) {
    return <Icon name="clock" size={12} color={color} />;
  }

  const seen = peerUid ? Boolean(message.seenBy?.[peerUid]) : false;

  return (
    <View style={styles.wrap}>
      <Icon name={seen ? 'doubleCheck' : 'check'} size={15} color={seen ? seenColor : color} />
    </View>
  );
}

const styles = StyleSheet.create({
  // done-all is wider than check; a fixed box stops the meta row reflowing when
  // a message flips from delivered to seen.
  wrap: { width: 16, alignItems: 'center', justifyContent: 'center' },
});
