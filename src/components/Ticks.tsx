import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import type { Message } from '@/src/config/types';
import { Icon } from './Icon';

/**
 * Delivery state, WhatsApp semantics:
 *   clock  — queued locally, not yet at the server
 *   check  — written to the database
 *   done-all — the recipient has opened it (tinted)
 * A failed send shows a red warning instead; the bubble itself offers the retry.
 *
 * Groups need `recipients`: WhatsApp only tints a group message once EVERY other
 * member has read it, so a single peer uid cannot express the condition. Passing
 * `peerUid` alone for a group would leave every message on one grey check
 * forever, which is what happened before this took a list.
 */
export function Ticks({
  message,
  peerUid,
  recipients,
  color,
  seenColor,
}: {
  message: Message;
  peerUid: string | null;
  /** Every uid that must have read it, excluding the sender. Groups only. */
  recipients?: string[] | null;
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

  const seenBy = message.seenBy;
  const seen =
    recipients && recipients.length > 0
      ? recipients.every((uid) => Boolean(seenBy?.[uid]))
      : peerUid
        ? Boolean(seenBy?.[peerUid])
        : false;

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
