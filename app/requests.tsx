import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ContactRequest } from '@/src/config/types';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Avatar } from '@/src/components/Avatar';
import { Icon } from '@/src/components/Icon';
import { Pressable } from '@/src/components/Pressable';
import { alertError } from '@/src/components/Confirm';
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
} from '@/src/services/ContactService';
import {
  selectIncomingRequests,
  selectOutgoingRequests,
  useAppStore,
} from '@/src/services/StateManager';

type Row = ContactRequest | { header: string };

const isHeader = (r: Row): r is { header: string } => 'header' in r;

/**
 * Contact requests, both directions in one list.
 *
 * Received requests come first because they need a decision; sent ones are
 * informational and only offer "cancel".
 */
export default function RequestsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const myUid = useAppStore((s) => s.currentUser?.uid) ?? null;
  const users = useAppStore((s) => s.users);
  const incoming = useAppStore(selectIncomingRequests);
  const outgoing = useAppStore(selectOutgoingRequests);

  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (incoming.length > 0) {
      out.push({ header: incoming.length === 1 ? '1 request' : `${incoming.length} requests` });
      out.push(...incoming);
    }
    if (outgoing.length > 0) {
      out.push({ header: 'Sent' });
      out.push(...outgoing);
    }
    return out;
  }, [incoming, outgoing]);

  const run = useCallback(
    async (uid: string, fn: (me: string) => Promise<void>, failure: string) => {
      if (busy || !myUid) return;
      setBusy(uid);
      try {
        await fn(myUid);
      } catch (e) {
        console.warn('[Flyer/requests] action failed', e);
        alertError(failure, 'Please try again.');
      } finally {
        setBusy(null);
      }
    },
    [busy, myUid]
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.header, paddingTop: insets.top + 8 },
        ]}
      >
        <Pressable
          round={40}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={26} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Contact requests
        </Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item, i) => (isHeader(item) ? `h-${item.header}-${i}` : item.uid)}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        renderItem={({ item }) => {
          if (isHeader(item)) {
            return (
              <Text style={[styles.sectionHeader, { color: theme.colors.textMuted }]}>
                {item.header}
              </Text>
            );
          }

          const p = users[item.uid];
          const name = p?.name ?? 'Flyer user';
          const working = busy === item.uid;

          return (
            <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
              <Pressable
                onPress={() => router.push(`/user/${item.uid}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`View ${name}`}
                style={styles.rowMain}
              >
                <Avatar
                  uri={p?.photoURL}
                  name={name}
                  uid={item.uid}
                  size={48}
                  showPhoto={p?.privacy?.showPhoto !== false}
                />
                <View style={styles.rowText}>
                  <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text
                    style={[styles.sub, { color: theme.colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {p?.email ?? ''}
                  </Text>
                </View>
              </Pressable>

              {working ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : item.direction === 'incoming' ? (
                <View style={styles.actions}>
                  <Pressable
                    onPress={() =>
                      void run(
                        item.uid,
                        (me) => declineRequest(me, item.uid),
                        'Could not decline'
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Decline request from ${name}`}
                    style={[styles.ghost, { borderColor: theme.colors.border }]}
                  >
                    <Text style={[styles.ghostText, { color: theme.colors.textMuted }]}>
                      Decline
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      void run(
                        item.uid,
                        (me) => acceptRequest(me, item.uid),
                        'Could not accept'
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Accept request from ${name}`}
                    style={[styles.solid, { backgroundColor: theme.colors.accent }]}
                  >
                    <Text style={[styles.solidText, { color: theme.colors.accentText }]}>
                      Accept
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() =>
                    void run(item.uid, (me) => cancelRequest(me, item.uid), 'Could not cancel')
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel request to ${name}`}
                  style={[styles.ghost, { borderColor: theme.colors.border }]}
                >
                  <Text style={[styles.ghostText, { color: theme.colors.textMuted }]}>
                    Cancel
                  </Text>
                </Pressable>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="personAdd" size={44} color={theme.colors.textFaint} />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
              No pending requests
            </Text>
            <Text style={[styles.emptyBody, { color: theme.colors.textMuted }]}>
              Requests you send and receive show up here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingBottom: 10,
  },
  headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 19, fontWeight: '600', marginLeft: 4 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 72,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '500' },
  sub: { fontSize: 13, marginTop: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ghost: {
    height: 36,
    minWidth: 74,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  ghostText: { fontSize: 13, fontWeight: '600' },
  solid: {
    height: 36,
    minWidth: 74,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  solidText: { fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
